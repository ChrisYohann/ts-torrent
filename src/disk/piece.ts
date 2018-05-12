import {logger} from '../logging/logger'
import * as crypto from 'crypto'
import * as fs from 'fs'
import SeekPointer from './seekPointer'
import * as R from 'ramda'
import * as util from 'util'

const readFilePromised = util.promisify(fs.read)
const writeFilePromised = util.promisify(fs.write)

export type BytesWritten = number

export class PieceBlock {
    begin: number
    size: number

    constructor(begin: number, length: number){
        this.begin = begin
        this.size = length
    }
}


export default class Piece {
    readonly fingerPrint: Buffer
    readonly length: number
    pointers: SeekPointer[] = []
    blocks: PieceBlock[] = []
    isCompletedAndValid: boolean = false

    constructor(sha1Print: Buffer, pieceLength: number){
        this.fingerPrint = sha1Print
        this.length = pieceLength
    }

    write(begin: number, block: Buffer): Promise<{bytesWritten: number, isPieceCompletedAndValid: boolean}>  {
        const self: Piece = this
        if (block.length + begin > this.length){
            const message_error = `Write Error : (begin, blockLength) values (${begin}, ${block.length}) are incompatibles
            with bytes available in this piece (${this.length})`
            return Promise.reject(new Error(message_error))
        }

        const jobs: Promise<number>[] = []
        let newBegin: number = begin
        let blockRemaining: Buffer = block
        let filePointerIndex: number = this.getFilePointerIndex(begin)
        let isOverlap: boolean = true

        while (isOverlap) {
            const filePointer = this.pointers[filePointerIndex]
            const current_file_descriptor: number = filePointer.file_descriptor
            const current_offset: number = filePointer.file_offset + newBegin
            const bytesToWrite: number = blockRemaining.length
            const current_file_length: number = filePointer.file_length 
      
            logger.silly('Bytes to write : '+bytesToWrite)
            const bytesAvailableInCurrentFile = current_file_length - current_offset
            const bytesRemaining = bytesToWrite - bytesAvailableInCurrentFile
            logger.silly('Bytes Remaining : '+ bytesRemaining)
            logger.silly('Available : '+bytesAvailableInCurrentFile)
            isOverlap = bytesRemaining > 0
            if(isOverlap){
                logger.silly('Piece may overlapping 2 files. Bytes remaining to write : '+bytesRemaining)
            }
            const p: Promise<number> = new Promise((resolve, reject) => {
                (async () => {
                    logger.silly('Bytes to Write : ' + bytesToWrite + ' Bytes available :' + bytesAvailableInCurrentFile)
                    const maximumBytesWritable: number = Math.min(bytesToWrite, bytesAvailableInCurrentFile)
                    const {bytesWritten} = await writeFilePromised(
                        current_file_descriptor, 
                        blockRemaining,
                        0,
                        maximumBytesWritable, 
                        current_offset)
                    resolve(bytesWritten)
                })()
            })
            jobs.push(p)
            newBegin = 0
            blockRemaining = block.slice(bytesAvailableInCurrentFile)
            filePointerIndex++
        }

        return Promise.all(jobs).then(async (bytesWrittenArray) => {
            self.insertBlock(begin, block.length)
            self.mergeBlocks()
            const totalBytesWritten: number = R.sum(bytesWrittenArray)
            if(self.isCompleted()){
                const isPieceValid: boolean = await self.passSha1Verification()
                if (!isPieceValid){
                    self.blocks = []
                    return {bytesWritten: totalBytesWritten, isPieceCompletedAndValid: false}
                } else {
                    self.isCompletedAndValid = true
                    return {bytesWritten: totalBytesWritten, isPieceCompletedAndValid: true}
                }            
            } else {
                return {bytesWritten: totalBytesWritten, isPieceCompletedAndValid: false}
            }
        }).catch((error) => {
          logger.error('Global Error in Writing Pieces')
          logger.error(error)
          return {bytesWritten: 0, isPieceCompletedAndValid: false}
        })     
    }

    read(begin: number, length: number): Promise<Buffer> {
        if(this.length - begin < length){
            const message_error = `Read Error : (begin, length) values (${begin}, ${length}) are incompatibles
            with bytes available in this piece (${this.length})`
            return Promise.reject(new Error(message_error))   
        }
        let isOverlap: boolean = true
        const jobs: Promise<Buffer>[] = []
        let newBegin: number = begin
        let newLength: number = length
        let filePointerIndex: number = this.getFilePointerIndex(begin)
        while(isOverlap){
            const filePointer: SeekPointer = this.pointers[filePointerIndex]
            const current_file_descriptor: number = filePointer.file_descriptor
            const current_offset: number = filePointer.file_offset + newBegin
            const current_file_length: number = filePointer.file_length
            
            logger.silly('File length : '+current_file_length)
            logger.silly('Bytes to read : '+newLength)

            const bytesAvailableInCurrentFile: number = current_file_length - current_offset
            const bytesRemaining: number = newLength - bytesAvailableInCurrentFile
            logger.silly('Bytes Remaining : '+ bytesRemaining)
            isOverlap = bytesRemaining > 0
            if(isOverlap){
                logger.silly('Piece may overlapping 2 files. Bytes remaining to read : '+bytesRemaining)
            }
            const p: Promise<Buffer> = new Promise(async (resolve, reject) => {
                try {
                    const lengthPossibleToBeRead = Math.min(newLength, bytesAvailableInCurrentFile)
                    const {bytesRead, buffer} = await readFilePromised(
                    current_file_descriptor, 
                    Buffer.alloc(lengthPossibleToBeRead), 
                    0, 
                    lengthPossibleToBeRead, current_offset)
                    resolve(buffer)
                } catch (err){
                    console.log(err)
                    reject(err)
                }
            })
            jobs.push(p)
            newBegin = 0
            newLength = bytesRemaining
            filePointerIndex++
        }
        return Promise.all(jobs).then((listBuffers: Buffer[]) => {
            return Buffer.concat(listBuffers)
          }).catch((err) => {
            logger.error(err)
            return Buffer.alloc(0)
          })
    }

    mergeBlocks(): void {
        let nbBlocks: number = this.blocks.length
        let i = 0
        while(i < nbBlocks-1){
          const prevBlockBegin = this.blocks[i]['begin']
          const prevBlockLength = this.blocks[i]['size']
          const nextBlockBegin = this.blocks[i + 1]['begin']
          const nextBlockLength = this.blocks[i + 1]['size']
          if(prevBlockBegin+prevBlockLength >= nextBlockBegin){ //Overlap
            if(prevBlockBegin+prevBlockLength < nextBlockBegin+nextBlockLength){
                const pieceBlock = new PieceBlock(prevBlockBegin, nextBlockBegin + nextBlockLength - prevBlockBegin)
                this.blocks.splice(i, 2, pieceBlock)
              nbBlocks-- 
            } else {
              this.blocks.splice(i+1,1)
              nbBlocks--
            }
          } else {
            i++
          }
      }
    }

    insertBlock(begin: number, length: number): void {
        let rightIndex = 0
        let i = 0
        while((i < this.blocks.length) && (begin >= this.blocks[i]['begin'])){
            if(begin == this.blocks[i]['begin']){
                rightIndex = length > this.blocks[i]['size'] ? i : i+1
                break 
            }
            i++ 
            rightIndex++ 
        }
        this.blocks.splice(rightIndex, 0, new PieceBlock(begin, length))
    }

    addSeekPointer(pointer: SeekPointer): void{
        this.pointers.push(pointer)
    }

    getFilePointerIndex(begin: number): number {
        return R.findLastIndex((pointer: SeekPointer) => begin >= pointer.piece_offset, this.pointers)
    }

    getCompleted(): number {
        return this.blocks.reduce((acc, curr_value) => acc + curr_value.size, 0)
    }
    
    isCompleted(): boolean {
      return this.getCompleted() == this.length
    }

    async passSha1Verification(): Promise<boolean> {
        try {
            const expectedSHA1Print: Buffer = this.fingerPrint
            const data: Buffer = await this.read(0, length)
            const sha1_hash = crypto.createHash('sha1')
            sha1_hash.update(data)
            const digest: Buffer = sha1_hash.digest()
            return digest.equals(expectedSHA1Print)
        } catch (e){
            logger.error(e)
            return false
        }

    }





}


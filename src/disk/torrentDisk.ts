import Piece from './piece'
import SeekPointer from './seekPointer'
import * as mkdirp from 'mkdirp'
import {logger} from '../logging/logger'
import * as path_module from 'path'
import * as fs from 'fs'
import * as util from 'util'
import * as R from 'ramda'
import { BencodeDict } from '../bencode/types';
import { FileDescriptor, FileInfo} from './types'
import { TorrentDict, InfoDictionaryMultipleFiles, InfoDictionarySingleFile } from '../torrent/types'
import {CustomInfoDictCommon} from './customInfoDict'
import { INSPECT_MAX_BYTES } from 'buffer';

const openFilePromised = util.promisify(fs.open)
const mkdirpPromised = util.promisify(mkdirp)
const statsPromised = util.promisify(fs.stat)

const instanceOfDictMultipleFiles = (infoDict: InfoDictionaryMultipleFiles | InfoDictionarySingleFile): infoDict is InfoDictionaryMultipleFiles => 'files' in infoDict

const createCustomInfoDictFromMetaFile = (dict: TorrentDict, savepath: string): CustomInfoDictCommon => {
    const info_dict: InfoDictionaryMultipleFiles | InfoDictionarySingleFile = dict['info']
    console.log(info_dict)
    if (instanceOfDictMultipleFiles(info_dict)){
        const files = info_dict['files']
        const modified_files = files.map((fileInfo) => {
            const {length, path} = fileInfo
            const complete_path: string = path_module.join(savepath, ...path)
            return {length, path: complete_path}
        })
        return new CustomInfoDictCommon(dict.info.name, savepath, modified_files, info_dict['piece length'], info_dict['pieces'])
    } else {
        const complete_path: string = path_module.join(savepath, info_dict.name)
        const modified_files = [{length: info_dict.length, path : complete_path}]
        return new CustomInfoDictCommon(dict.info.name, savepath, modified_files, info_dict['piece length'], info_dict['pieces'])
    }
}

const computeChunkSizeToFillEmptyFile = (theoricalLength: number): {nbSteps: number; chunkSize: number; lastChunkSize: number} => {
    if (theoricalLength < 1 << 30) {
        return {
            nbSteps : 11,
            chunkSize : Math.floor(theoricalLength/10),
            lastChunkSize : theoricalLength % 10,
        }
    } else {
        const chunkSize = 1 << 30
        const nbSteps = Math.floor(theoricalLength/chunkSize) + 1
        const lastChunkSize = theoricalLength - (nbSteps - 1) * chunkSize
        return {
            nbSteps,
            chunkSize,
            lastChunkSize,
        }
    }
}

const checkIfFileHasRightLength = (path: string, theoricalLength: number) => async (fileDescriptor: number): Promise<FileInfo> => {
    const stats: fs.Stats = await statsPromised(path)
    logger.debug(`Theorical length : ${theoricalLength}. Actual Length : ${stats.size}`)
    return {fd: fileDescriptor, path, length: stats.size}
}

const fillWithEmptyBytes = (path: string, theoricalLength: number) => async (fileInfo: FileInfo): Promise<FileInfo> => {
    if (fileInfo.length == theoricalLength){
        return fileInfo
    } else {
        const {chunkSize, nbSteps, lastChunkSize} = computeChunkSizeToFillEmptyFile(theoricalLength)
        const chunk = Buffer.allocUnsafe(chunkSize)
        const lastChunk = Buffer.alloc(lastChunkSize)
        const wstream = fs.createWriteStream(fileInfo.path)
        const result = await new Promise((resolve: (value: FileInfo) => void, reject) => {
            let i = nbSteps
            const writeLoop = () => {
                let ok = true;
                
                do {
                  i--;
                  if (i === 0) {
                    wstream.write(lastChunk, 'utf8', (err) => {
                        if (err){
                            logger.error(err)
                            reject(err)
                        } else {
                            resolve({fd: fileInfo.fd, path, length: theoricalLength})
                        }
                    });
                  } else {
                    // see if we should continue, or wait
                    // don't pass the callback, because we're not done yet.
                    console.log(`Writing Chunk ${i}. Size : ${chunk.length}`)
                    ok = wstream.write(chunk, 'utf8');
                  }
                } while (i > 0 && ok);
                if (i > 0) {
                  wstream.once('drain', writeLoop);
                }
            }
            writeLoop();
        })
        return result
    }
}

export const openOrCreateFile = (path: string, theoricalLength: number): Promise<FileInfo> => {
    return openFilePromised(path, 'a+')
    .then(checkIfFileHasRightLength(path, theoricalLength))
    .then(fillWithEmptyBytes(path, theoricalLength))
}

export const bitfieldContainsPiece = (bitfield: Buffer, pieceIndex: number): boolean => {
    const group = ~~(pieceIndex/8);
    const shift = 8 - pieceIndex%8 - 1 ;
    const mask = 1<<shift;
    return (bitfield[group] & mask) != 0;
};

export const updateBitfield = (bitfield: Buffer, pieceIndex:  number): Buffer =>{
    const group = ~~(pieceIndex/8);
    const shift = 8 - pieceIndex%8 - 1 ;
    bitfield[group] |= 1<<shift;
    return bitfield;
};

export default class TorrentDisk {
    infoDictionary:  CustomInfoDictCommon
    savepath: string
    pieces: Piece[] = []
    files: FileInfo[] = []
    completed: number = 0
    isDirectory: boolean
    bitfield: Buffer

    constructor(metaFile: TorrentDict, savepath: string){
        this.infoDictionary = createCustomInfoDictFromMetaFile(metaFile, savepath)
        this.savepath = savepath
    }

    async init(): Promise<number>{
        logger.info(`Init disk for ${this.infoDictionary.name}. Savepath : ${this.savepath}`)
        const fileInfos: FileInfo[] = await this.initFiles(this.infoDictionary.getFilesInfos())
        logger.info(`FileInfos : ${JSON.stringify(fileInfos)}`)
        const pieces: Piece[] = await this.initPieces(this.infoDictionary, fileInfos)
        logger.info(`Init pieces`)
        this.files = fileInfos
        this.pieces = pieces
        return 0
    }

    async initFiles(fileInfosWithoutDescriptor: {path: string, length: number}[]): Promise<FileInfo[]> {
        try {
            try {
                await mkdirpPromised(this.savepath)
            } catch (err){
                if (err.code !== 'EEXIST'){
                    Promise.reject(err)
                }
            }
            const fileInfos = await R.map(async ({path, length}): Promise<FileInfo> => {
            logger.verbose(`Opening File at ${path}. Length : ${length} bytes`)
            const fileInfo: FileInfo = await openOrCreateFile(path, length)
            logger.verbose(`File opened. descriptor : ${fileInfo.fd}`)
            return fileInfo
            }, fileInfosWithoutDescriptor)
            return Promise.all(fileInfos)
        } catch (err){
            return Promise.reject(err)
        }
    }

    async initPieces(infoDictCustom: CustomInfoDictCommon, files: FileInfo[]): Promise<Piece[]>  {
        const nbPieces: number = infoDictCustom.nbPieces
        const totalSize: number = infoDictCustom.totalSize
        const lastPieceLength: number = infoDictCustom.computeLastPieceLength()
        const piecesPrints: Buffer = infoDictCustom.pieces
        const pieceLength: number = infoDictCustom.piece_length
        let result: Piece[] = []

        let fileOffset = 0;
        let pieceOffset = 0;
        let fileIndex = 0;

        for(let i = 0; i < nbPieces ; i++){
            const pieceFingerPrint: Buffer = piecesPrints.slice(20 * i, 20 * (i + 1))
            const lengthPiece = (i != nbPieces - 1 ) ? pieceLength : lastPieceLength
            const piece = new Piece(pieceFingerPrint, lengthPiece)

            let bytesPieceRemaining = lengthPiece
            while(bytesPieceRemaining > 0){
                const {fd, path, length} = files[fileIndex]
                piece.addSeekPointer(new SeekPointer(fd, fileOffset, pieceOffset, length))
                if(bytesPieceRemaining > length - fileOffset){
                    pieceOffset += length - fileOffset
                    bytesPieceRemaining = bytesPieceRemaining - length + fileOffset
                    fileOffset = 0
                    fileIndex ++
                } else if (bytesPieceRemaining < length - fileOffset){
                    fileOffset += bytesPieceRemaining;
                    bytesPieceRemaining = 0;
                    pieceOffset = 0
                } else {
                    fileOffset = 0;
                    bytesPieceRemaining = 0;
                    pieceOffset = 0;
                    fileIndex++
                }
            }
            result = R.append(piece, result)
        }
        return result
    }

    read(index: number, begin: number, length: number): Promise<Buffer> {
        const piece = this.pieces[index]
        return piece.read(begin, length)
    }

    write(index: number, begin: number, block: Buffer): Promise<{bytesWritten: number, isPieceCompletedAndValid: boolean}> {
        const self = this
        const piece = this.pieces[index]
        if(!piece.isCompletedAndValid){
            return piece.write(begin, block).then((result: {bytesWritten: number, isPieceCompletedAndValid: boolean}) => {
                const {bytesWritten, isPieceCompletedAndValid} = result
                if(isPieceCompletedAndValid){
                    logger.verbose(`Piece ${index} is completed.`)
                    self.bitfield = updateBitfield(self.bitfield, index)
                }
                return result
            })
        } else {
            return Promise.resolve({bytesWritten: 0, isPieceCompletedAndValid: true})
        }
    }

    async getBitfield(): Promise<{bitfield: Buffer, completed: number}> {
        let completed = 0
        const pieces = this.pieces
        const nbPieces = this.pieces.length
        const bitFieldBuffer: Buffer = Buffer.alloc((nbPieces >> 3) + ((nbPieces & 0x7) != 0 ? 1 : 0))
        const promises: Promise<boolean>[] = R.map((piece: Piece) => piece.passSha1Verification(), pieces)
        const verifiedPieces = await (Promise.all(promises))
        verifiedPieces.forEach((isPieceCompleteAndValid: boolean, pieceIndex: number) => {
            bitFieldBuffer[pieceIndex >> 3] |= ( isPieceCompleteAndValid ? 0x80 : 0) >> (pieceIndex & 0x7)
            if (isPieceCompleteAndValid){
                completed += pieces[pieceIndex].length
            }
        })
        this.bitfield = bitFieldBuffer
        logger.info(JSON.stringify({name : this.infoDictionary.name, completed}))
        return { bitfield: bitFieldBuffer, completed }
        
    }

    async verify(): Promise<number> {
        const pieces = this.pieces
        const blocksCompleted: number[] = await Promise.all(pieces.map(async (piece: Piece, index: number) => {
            const isPieceCompleted: boolean = await piece.passSha1Verification()
            return isPieceCompleted ? piece.length : 0
        }))
        const completed: number = R.sum(blocksCompleted)
        this.completed = completed
        logger.info(JSON.stringify({name : this.infoDictionary.name, completed}))
        return completed
    }

    clear(): void {
        
    }

}
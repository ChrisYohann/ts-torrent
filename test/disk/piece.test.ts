import {expect, assert} from 'chai'
import * as tmp from 'tmp'
import * as crypto from 'crypto'
import Piece from '../../src/disk/piece'
import SeekPointer from '../../src/disk/seekPointer'
import * as R from 'ramda'
import * as fs from 'fs'
import * as path from 'path'
import * as util from 'util'

type SeekPointerArgs = {fd: number, offset_file: number, offset_piece: number, file_length: number}

/*######## UNIT TESTS ######## */
describe('##### PIECE TESTS #####', () =>{
    describe('*** Read Tests ***', () => {
        let temp_dir: tmp.SynchrounousResult
        let files: number[] = []
        let contents: Buffer[] = []
    
        before((done: MochaDone) => {
            temp_dir = tmp.dirSync({unsafeCleanup: true})
            const dir_name: string = temp_dir.name
            console.log(`Temporary Directory created at ${dir_name} for unit tests.`)
            const fd1: number = fs.openSync(`${dir_name}${path.sep}file1.bin`, 'a+')
            const data1 = crypto.randomBytes(10)
            fs.writeSync(fd1, data1)
            files.push(fd1)
            contents.push(data1)
            const fd2: number = fs.openSync(`${dir_name}${path.sep}file2.bin`, 'a+')
            const data2 = crypto.randomBytes(10)
            fs.writeSync(fd2, data2)
            files.push(fd2)
            contents.push(data2)
            done()
        })
        
        after((done: MochaDone) => {
            temp_dir.removeCallback()
            done()
        })
    
        it('It should set the right file cursors for each piece', () => {
      
            /*Piece 1 => Length : 3
                        File 1 Offset : 8   Piece Offset : 0
                        File 2 Offset : 0   Piece Offset : 2
              Piece 2 => Length : 3
                        File 2 Offset : 1 : Piece Offset : 0
            */
              const randomBuffer: Buffer = Buffer.allocUnsafe(20) 
              const piece1 = new Piece(randomBuffer, 3)
              const piece2 = new Piece(randomBuffer, 3)
    
              const offset_file11 = 8
              const offset_piece11 = 0
              const file_length1 = 10
    
              const offset_file12 = 0
              const offset_piece12 = 2
              const file_length2 = 10
    
              const offset_file21 = 1
              const offset_piece21 = 0
    
              piece1.addSeekPointer(new SeekPointer(files[0], offset_file11, offset_piece11, file_length1))
              piece1.addSeekPointer(new SeekPointer(files[1], offset_file12, offset_piece12, file_length2))
              piece2.addSeekPointer(new SeekPointer(files[1], offset_file21, offset_piece21, file_length2))
    
              expect(piece1.getFilePointerIndex(0)).to.equal(0)
              expect(piece1.getFilePointerIndex(1)).to.equal(0)
              expect(piece1.getFilePointerIndex(2)).to.equal(1)
        })
    
        it('It should return one block from one file', async () => {
            const randomBuffer: Buffer = Buffer.allocUnsafe(20)
            const piece1 = new Piece(randomBuffer, 3)
            const piece2 = new Piece(randomBuffer, 3)
            piece1.addSeekPointer(new SeekPointer(files[0], 8, 0, 10))
            piece1.addSeekPointer(new SeekPointer(files[1], 0, 2, 10))
    
            try {
                const blockRead = await piece1.read(0, 2)
                const expectedResult = contents[0].slice(8)
                expect(blockRead).to.eql(expectedResult)
            } catch (err) {
                console.log(err)
            }
    
        })
    
        it('It should concat 2 blocks from 2 files', async () => {
            const randomBuffer: Buffer = Buffer.allocUnsafe(20)
            const piece1 = new Piece(randomBuffer, 3)
            const piece2 = new Piece(randomBuffer, 3)
            piece1.addSeekPointer(new SeekPointer(files[0], 8, 0, 10))
            piece1.addSeekPointer(new SeekPointer(files[1], 0, 2, 10))
    
    
            const blockRead = await piece1.read(0, 3)
            const expectedResult = Buffer.concat([contents[0].slice(8), contents[1].slice(0, 1)])
            expect(blockRead).to.eql(expectedResult)
        })
    })

    describe('*** Merge Blocks Tests ***', () => {
        const block1 = {begin: 0, size: 5}
        const block2 = {begin: 10, size: 5}
        const piece = new Piece(Buffer.allocUnsafe(20), 20)
        beforeEach(() => {
            piece.blocks = []
            piece.blocks.push(block1)
            piece.blocks.push(block2)
        })

        it('Merge 2 adjacents blocks without overlap - It should merge block1 and block3', () => {
            const block3 = {begin: 5, size: 3}
            piece.insertBlock(block3.begin, block3.size)
            piece.mergeBlocks()
            expect(piece.blocks).to.deep.equal([{begin : 0, size : 8}, block2])
        })

        it('Merge 2 adjacents blocks with overlap - It should merge block1 and block3 without summing length', () => {
            const block3 = {begin: 3, size: 3}
            piece.insertBlock(block3.begin, block3.size)
            piece.mergeBlocks()
            expect(piece.blocks).to.deep.equal([{begin : 0, size : 6}, block2])
        })

        it('Merge 3 adjacents blocks without overlap - It should return only one block', () => {
            const block3 = {begin: 5, size: 5}
            piece.insertBlock(block3.begin, block3.size)
            piece.mergeBlocks()
            expect(piece.blocks).to.deep.equal([{begin : 0, size : 15}])
        })

        it('Merge 3 adjacents blocks without overlap - It should return only one block', () => {
            const block3 = {begin: 3, size: 9}
            piece.insertBlock(block3.begin, block3.size)
            piece.mergeBlocks()
            expect(piece.blocks).to.deep.equal([{begin : 0, size : 15}])
        })

        it('Merge 2 blocks with 1 block at the end - It should merge block2 and block3', () => {
            const block3 = {begin: 13, size: 8}
            piece.insertBlock(block3.begin, block3.size)
            piece.mergeBlocks()
            expect(piece.blocks).to.deep.equal([block1, {begin : 10, size : 11}])
        })

        it('Merge 2 groups of 2 blocks with one at the end - It should merge block 1/block 3 and block 2/block 4', () => {
            const block3 = {begin: 3, size: 4}
            const block4 = {begin: 13, size: 8}
            piece.insertBlock(block4.begin, block4.size)
            piece.insertBlock(block3.begin, block3.size)
            piece.mergeBlocks()
            expect(piece.blocks).to.deep.equal([{begin : 0, size : 7}, {begin : 10, size : 11}])
        })

        it('Merge 2 blocks with in completely included in the other - It should delete block3', () => {
            const block3 = {begin: 3, size: 2}
            piece.insertBlock(block3.begin, block3.size)
            piece.mergeBlocks()
            expect(piece.blocks).to.deep.equal([block1, block2])
        })
    })

    describe('*** Insert Block Tests ***', () => {
        const block1 = {begin: 0, size: 5}
        const block2 = {begin: 10, size: 5}
        const piece = new Piece(null, 20)
        beforeEach(() => {
            piece.blocks = []
            piece.blocks.push(block1)
            piece.blocks.push(block2)
        })

        it('Insert one block between 2 blocks of different begin value - It should insert block between 2 others blocks', () => {
            const block3 = {begin: 5, size: 5}
            piece.insertBlock(block3.begin, block3.size)
            expect(piece.blocks).to.deep.equal([block1, block3, block2])
        })

        it('Insert one block between 2 blocks with one sharing the same begin value - It should insert the longest block before', () => {
            const block3 = {begin: 0, size: 10}
            piece.insertBlock(block3.begin, block3.size)
            expect(piece.blocks).to.deep.equal([block3, block1, block2])
        })

        it('Insert one block at the end - It should insert the block at the end of the Array', () => {
            const block3 = {begin: 11, size: 5}
            piece.insertBlock(block3.begin, block3.size)
            expect(piece.blocks).to.deep.equal([block1, block2, block3])
        })
    })

    describe('*** Write Tests ***', () => {
        let temp_dir: tmp.SynchrounousResult
        let files: number[] = []
        let piece1: Piece
        let piece2: Piece
    
        before((done: MochaDone) => {
            temp_dir = tmp.dirSync({unsafeCleanup: true})
            const dir_name: string = temp_dir.name
            console.log(`Temporary Directory created at ${dir_name} for write tests.`)
            const fd1: number = fs.openSync(`${dir_name}${path.sep}file1.bin`, 'a+')
            fs.writeSync(fd1, Buffer.alloc(10))
            files.push(fd1)
            const fd2: number = fs.openSync(`${dir_name}${path.sep}file2.bin`, 'a+')
            fs.writeSync(fd2, Buffer.alloc(10))
            files.push(fd2)
            piece1 = new Piece(Buffer.allocUnsafe(20), 3)
            piece2 = new Piece(Buffer.allocUnsafe(20), 3)
            piece1.addSeekPointer(new SeekPointer(fd1, 8, 0, 10))
            piece1.addSeekPointer(new SeekPointer(fd2, 0, 2, 10))
            done()
        })
        
        after((done: MochaDone) => {
            temp_dir.removeCallback()
            done()
        })

        it('Write 1 block to a Non Overlap Piece - It should write data to the right place', async () => {
            const data: Buffer = new Buffer([0xff, 0xff])
            const {bytesWritten, isPieceCompletedAndValid} = await piece1.write(0, data)
            expect(bytesWritten).to.equal(2)
            const {bytesRead, buffer} = await util.promisify(fs.read)(files[0], Buffer.alloc(2), 0, 2, 8)
            expect(buffer).to.eql(data)
        })
    
        it('Write 1 block to a Overlap Piece - It should write data to both files', async () => {
            const data: Buffer = new Buffer([0xee, 0xee, 0xee])
            const {bytesWritten, isPieceCompletedAndValid} = await piece1.write(0, data)
            expect(bytesWritten).to.equal(3)
            const part1: {bytesRead: number, buffer: Buffer} = await util.promisify(fs.read)(files[0], Buffer.alloc(2), 0, 2, 8)
            const part2: {bytesRead: number, buffer: Buffer} = await util.promisify(fs.read)(files[1], Buffer.alloc(1), 0, 1, 0)
            expect(Buffer.concat([part1.buffer, part2.buffer])).to.eql(data)
        })
    })
})
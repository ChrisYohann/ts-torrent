import {expect, assert} from 'chai'
import * as tmp from 'tmp'
import * as crypto from 'crypto'
import Piece from '../../src/disk/piece'
import SeekPointer from '../../src/disk/seekPointer'
import TorrentDisk from '../../src/disk/torrentDisk'
import * as TorrentDiskFunctions from '../../src/disk/torrentDisk'
import * as R from 'ramda'
import * as fs from 'fs'
import * as path from 'path'
import * as util from 'util'
import { TorrentDict } from '../../src/torrent/types';
import * as infoDictionary from '../../src/torrent/infoDictionary'
import { FileInfo } from '../../src/disk/types';

const createPieces = (pieceSize, ...chunks: Buffer[]): Buffer => {
  let sha1 = crypto.createHash('sha1')
  const pieces: Buffer[] = []
  const wholeChunk: Buffer = Buffer.concat(chunks)
  const totalLength: number = wholeChunk.length
  if (pieceSize > totalLength){
    sha1.update(wholeChunk)
    return sha1.digest()
  } else {
      for (let i = 0 ; i < totalLength ; i++){
        if ((i % pieceSize) == 0 && (i != 0)){
          pieces.push(sha1.digest())
        }
        sha1 = crypto.createHash('sha1')
        sha1.update(wholeChunk.slice(i, i+1))
      }
      pieces.push(sha1.digest())
  }
  return Buffer.concat(pieces)
}

const statsPromised = util.promisify(fs.stat)

const data1 = crypto.randomBytes(10)
const mockTorrentDictSingleFile: TorrentDict = {
  'announce' : 'announce',
  'announce-list' : [['announce-list']],
  'created by' : 'test',
  'encoding' : 'utf8',
  'info' : {
    'name' : 'file1.bin',
    'piece length' : 2,
    'pieces' : createPieces(2, data1),
    'length' : 10
  }
}
const mockTorrentDictMultipleFiles: TorrentDict = {
    'announce' : 'announce',
    'announce-list' : [['announce-list']],
    'created by' : 'test',
    'encoding' : 'utf8',
    'info' : {
      'name' : 'testdir',
      'piece length' : 2,
      'pieces' : createPieces(2, data1, Buffer.alloc(30)),
      'files' : [
        {
          'path' : ['testdir', 'file1.bin'],
          'length' : 10
        },
        {
          'path' : ['testdir', 'file2.bin'],
          'length' : 30
        }
      ]
    }
}



describe('### TorrentDisk Tests ###', () => {

    let temp_dir: tmp.SynchrounousResult
    let files: number[] = []
    let contents: Buffer[] = []
    let torrentDiskMultipleFiles: TorrentDisk
    let torrentDiskSingleFile: TorrentDisk

    before((done: MochaDone) => {
        temp_dir = tmp.dirSync({unsafeCleanup: true})
        const dir_name: string = temp_dir.name
        fs.mkdirSync(path.join(dir_name, 'testdir'))
        torrentDiskSingleFile = new TorrentDisk(mockTorrentDictSingleFile, path.join(dir_name, 'testdir'))
        torrentDiskMultipleFiles = new TorrentDisk(mockTorrentDictMultipleFiles, dir_name)
        console.log(`Temporary Directory created at ${dir_name} for unit tests.`)
        const fd1: number = fs.openSync(path.join(dir_name, 'testdir', 'file1.bin'), 'a+')
        fs.writeSync(fd1, data1)
        files.push(fd1)
        contents.push(data1)
        done()
    })
    
    after((done: MochaDone) => {
        temp_dir.removeCallback()
        done()
    })

    it('should open a file already created', async () => {
        const fileInfo = await TorrentDiskFunctions.openOrCreateFile(path.join(temp_dir.name,'testdir', 'file2.bin'), 30)
        const stats = await statsPromised(fileInfo.path)
        expect(stats.size).to.equal(30)
    })

    it('it should compute the right total size', () => {
      expect(torrentDiskMultipleFiles.info_dictionary.totalSize).to.eql(40)
      expect(torrentDiskSingleFile.info_dictionary.totalSize).to.eql(10)      
    })

    it('should init Files properly', async () => {

    })

    it('should init pieces single file properly', async() => {

    })
    
    it('should init pieces multiple files with overlap properly', async() => {
      
    })
/*
  
      describe("Test Init Files function", function(){
        describe("Retrieve path of all the files in the torrent in Single File Mode", function(){
          it("It should only put the filepath attribute in fileNames List", function(){
            torrentDiskSingleFile.retrieveFileNamesAndLengths();
            expect(torrentDiskSingleFile.fileNamesPath).to.deep.equal([testSingleFile+".bin"])
          })
        });
  
        describe("Retrieve path of all the files in the torrent in Multiple Files Mode ", function(){
          it("It should retrieve the relative path for all the files in the Torrent", function(){
            torrentDiskMultipleFiles.retrieveFileNamesAndLengths();
            expect(torrentDiskMultipleFiles.fileNamesPath).to.deep.equal([testMultipleFiles+path.sep+"File1.bin", testMultipleFiles+path.sep+"File2.bin"])
          })
        })
      });
  
      describe("Init Pieces Single File", function(){
        it("It should init cursor to the right place", function(){
          torrentDiskSingleFile.initPieces();
          for(let i = 0 ; i<10 ; i++){
            torrentDiskSingleFile.pieces[i]["files"].forEach(function(fileCursor){
                const filename = fileCursor.getFile().filename;
                const offsetFile = fileCursor.getFileOffset();
                const offsetPiece = fileCursor.getPieceOffset();
                const result = {name: filename, fileOffset: offsetFile, pieceOffset: offsetPiece};
                expect(result).to.eql({name : testSingleFile+".bin", fileOffset : i, pieceOffset : 0})
            })
          }
        })
      });
  
      describe("Init Pieces multipleFiles with Piece overlap", function(){
        it("Test several files function", function(){
          torrentDiskMultipleFiles.initPieces();
            const actualResult = [];
            torrentDiskMultipleFiles.pieces[5]["files"].forEach(function(fileCursor){
                const filename = fileCursor.getFile().filename;
                const offsetFile = fileCursor.getFileOffset();
                const offsetPiece = fileCursor.getPieceOffset();
                const result = {name: filename, fileOffset: offsetFile, pieceOffset: offsetPiece};
                actualResult.push(result)
            });
            expect(actualResult).to.eql([{name : testMultipleFiles+path.sep+"File1.bin", fileOffset : 10, pieceOffset : 0}, {name : testMultipleFiles+path.sep+"File2.bin", fileOffset : 0, pieceOffset : 1}])
        })
      })
    });
  
    describe("Test verify function for Single File", function(){
        const parsedTorrentSingleFile = bencodeDecoder.decode(testSingleFile + ".torrent");
        const torrentDiskSingleFile = new TorrentDisk(parsedTorrentSingleFile, testSingleFile + ".bin");
  
        describe("Test verify on a 100% completed File", function(){
        it("The function should return the length of the file", function(){
          //torrentDiskSingleFile.initPieces()
          return torrentDiskSingleFile.verify().should.eventually.equal(10)
        })
      })
    });
  
    describe("Test verify function for MultipleFiles", function(){
        const parsedTorrentMultipleFiles = bencodeDecoder.decode(testMultipleFiles + ".torrent");
        const torrentDiskMultipleFiles = new TorrentDisk(parsedTorrentMultipleFiles, testMultipleFiles);
  
        describe("Test verify function on a 100% completed Files", function(){
        it("The function should return the sum of both files lengths", function(){
          //torrentDiskMultipleFiles.initPieces()
          console.log(`Total Size : ${torrentDiskMultipleFiles.totalSize} ; Piece Length : ${torrentDiskMultipleFiles["metaFile"]["info"]["piece length"]}`);
          return torrentDiskMultipleFiles.verify().should.eventually.equal(22)
        })
      })
  
    });
  
    describe("Test Bitfield function for SingleFile", function(){
        const parsedTorrentSingleFile = bencodeDecoder.decode(testSingleFile + ".torrent");
        const torrentDiskSingleFile = new TorrentDisk(parsedTorrentSingleFile, testSingleFile + ".bin");
  
        describe("Test BitField function on a 100% completed File", function(){
        it("All the index for 10 pieces should be set to 1", function(){
          //torrentDiskSingleFile.initPieces()
            const expectedResult = Buffer.from([0xff, 0xc0]);
            return torrentDiskSingleFile.getBitfieldFromFile().should.eventually.deep.equal(expectedResult)
        })
      })
    });
  
    describe("Test Bitfield function for MultipleFiles", function(){
        const parsedTorrentMultipleFiles = bencodeDecoder.decode(testMultipleFiles + ".torrent");
        const torrentDiskMultipleFiles = new TorrentDisk(parsedTorrentMultipleFiles, testMultipleFiles);
  
        describe("Test BitField function on a 100% completed File", function(){
        it("All the index for 11 pieces should be set to 1", function(){
          //torrentDiskMultipleFiles.initPieces()
            const expectedResult = Buffer.from([0xff, 0xe0]);
            return torrentDiskMultipleFiles.getBitfieldFromFile().should.eventually.deep.equal(expectedResult)
        })
      })
    })
  });
    */
    
})
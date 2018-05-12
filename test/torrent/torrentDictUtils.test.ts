import { expect, assert } from 'chai'
import { BencodeDict } from '../../src/bencode/types'
import * as tmp from 'tmp'
import * as crypto from 'crypto'
import createTorrent from '../../src/torrent/create'
import { Maybe } from 'monet'
import * as TorrentDictUtils from '../../src/torrent/torrentDictUtils'
import { TorrentDict } from '../../src/torrent/types';

const sha1Print: Buffer = crypto.randomBytes(20)

const infoSingleFile: BencodeDict = new BencodeDict({
    'piece length': 5,
    'pieces' : sha1Print,
    'name' : 'test.bin',
    'length' : 10
})

const infoMultipleFiles: BencodeDict = new BencodeDict({
    'piece length' : 10,
    'pieces' : sha1Print,
    'name' : 'dir1',
    'files' : [
        {
            'length' : 5,
            'path' : ['dir1', 'dir2', 'file1.bin']
        },
        {
            'length' : 10,
            'path' : ['dir1', 'file2.bin']
        }
    ]
})

const validTorrentDictSingleFile: BencodeDict = new BencodeDict({
    'announce' : 'announce',
    'announce-list' : [['liste']],
    'creation date' : 10928390,
    'created by' : 'test',
    'encoding' : 'utf8',
    'info' : infoSingleFile
})

const validTorrentDictMultipleFiles: BencodeDict = new BencodeDict({
    'announce' : 'announce',
    'announce-list' : [['liste']],
    'creation date' : 10928390,
    'created by' : 'test',
    'encoding' : 'utf8',
    'info' : infoMultipleFiles
})

const invalidTorrentDictMissingKey: BencodeDict = new BencodeDict({
    'announce' : 'announce',
    'announce-list' : [['liste']],
    'creation date' : 10928390,
    'created by' : 'test',
    'encoding' : 'utf8',
})

const invalidTorrentDictWrongFormatValue: BencodeDict = new BencodeDict({
    'announce' : 18,
    'announce-list' : [['liste']],
    'creation date' : 10928390,
    'created by' : 'test',
    'encoding' : 'utf8',
    'info' : infoMultipleFiles
})

const invalidTorrentDictWrongInfo: BencodeDict = new BencodeDict({
    'announce' : 'announce',
    'announce-list' : [['liste']],
    'creation date' : 10928390,
    'created by' : 'test',
    'encoding' : 'utf8',
    'info' : 'dummyValue'
})

describe('### TorrentDictUtils Function', () => {
    it('should check infoDictionary for singleFile', () => {
        const expectedResult = TorrentDictUtils.checkInfoDictSingleFile(infoSingleFile.get())
        expect(expectedResult).to.equal(true)
    })

    it('should check infoDictionary for multipleFiles', () => {
        const expectedResult = TorrentDictUtils.checkInfoDictMultipleFiles(infoMultipleFiles.get())
        expect(expectedResult).to.equal(true)
    })

    it('should convert bencode dict single file in torrent dict', () => {
        const actualResult: Maybe<TorrentDict> = 
            TorrentDictUtils.convertBencodeDictInTorrentDict(validTorrentDictSingleFile)
        expect(actualResult.isSome()).to.equal(true)
    })

    it('should convert bencode dict multiple files in torrent dict', () => {
        const actualResult: Maybe<TorrentDict> = 
            TorrentDictUtils.convertBencodeDictInTorrentDict(validTorrentDictMultipleFiles)
        assert(actualResult.isSome())
    })

    it('should not convert bencode dict because missing key', () => {
        const actualResult: Maybe<TorrentDict> = 
            TorrentDictUtils.convertBencodeDictInTorrentDict(invalidTorrentDictMissingKey)
        assert(actualResult.isNone())
    })

    it('should not convert bencode dict because wrong format key', () => {
        const actualResult: Maybe<TorrentDict> = 
            TorrentDictUtils.convertBencodeDictInTorrentDict(invalidTorrentDictWrongFormatValue)
        assert(actualResult.isNone())
    })

    it('should not convert bencode dict because wrong info', () => {
        const actualResult: Maybe<TorrentDict> = 
            TorrentDictUtils.convertBencodeDictInTorrentDict(invalidTorrentDictWrongInfo)
        assert(actualResult.isNone())
    })
})


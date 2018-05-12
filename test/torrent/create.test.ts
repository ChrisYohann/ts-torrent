import {expect, assert} from 'chai'
import {BencodeDict} from '../../src/bencode/types'
import  * as infoDictionary from '../../src/torrent/infoDictionary'
import * as tmp from 'tmp'
import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import { TorrentProperties } from '../../src/torrent/types';
import createTorrent from '../../src/torrent/create'
import {Either, Right, Left} from 'monet'

describe('Create Bencode Torrent Object from some properties', () => {
    let temp_dir: tmp.SynchrounousResult

    before((done: MochaDone) => {
        temp_dir = tmp.dirSync({unsafeCleanup: true})
        const dir_name: string = temp_dir.name
        console.log(`Temporary Directory created at ${dir_name} for unit tests.`)
        done()
    })

    after((done: MochaDone) => {
        temp_dir.removeCallback()
        done()
    })
    
    it('should create a BencodeDict from a single file', async () => {
        const data1: Buffer = crypto.randomBytes(10)
        const file1_path: string = `${temp_dir.name}${path.sep}file1.bin`
        fs.writeFileSync(file1_path, data1)
        const torrentProperties: TorrentProperties = {
            filepath : file1_path,
            announce : 'localhost:8000/announce',
            announce_list : 'localhost:8000/announce;localhost:8001/announce',
            comment : 'Torrent created for tests'
        }
        const actualResultEither: Either<Error, BencodeDict> = await createTorrent(torrentProperties)
        assert(actualResultEither.isRight())
        const actualResult: BencodeDict = actualResultEither.right()
        expect(actualResult).to.be.instanceof(BencodeDict)
        const actualResultValue: Object = actualResult.get()
        const keys: string[] = Object.keys(actualResultValue)
        expect(keys.sort()).to.eql(['announce', 'announce-list', 'comment', 'created by', 'creation date', 'encoding', 'info'])
        const announce_list: any = actualResultValue['announce-list']
        const expected_announce_list = [
            [Buffer.from('localhost:8000/announce')],
            [Buffer.from('localhost:8001/announce')]
        ]
        expect(announce_list).to.eql(expected_announce_list)
    })

    it('should create a BencodeDict from a directory', async () => {
        const data2: Buffer = crypto.randomBytes(20)
        fs.mkdirSync(`${temp_dir.name}${path.sep}dir1`)
        const file2_path: string = `${temp_dir.name}${path.sep}dir1${path.sep}file2.bin`
        fs.writeFileSync(file2_path, data2)
        const torrentProperties: TorrentProperties = {
            filepath : temp_dir.name,
            announce : 'localhost:8000/announce',
            announce_list : 'localhost:8000/announce;localhost:8001/announce',
            comment : 'Torrent created for tests'
        }
        const actualResultEither: Either<Error, BencodeDict> = await createTorrent(torrentProperties)
        assert(actualResultEither.isRight())
        const actualResult: BencodeDict = actualResultEither.right()
        expect(actualResult).to.be.instanceof(BencodeDict)
        const actualResultValue: Object = actualResult.get()
        const keys: string[] = Object.keys(actualResultValue)
        expect(keys.sort()).to.eql(['announce', 'announce-list', 'comment', 'created by', 'creation date', 'encoding', 'info'])
        const info_dictionary: Object = actualResultValue['info']
        const info_keys: string[] = Object.keys(info_dictionary)
        expect(info_keys.sort()).to.eql(['files', 'name', 'piece length', 'pieces'])
        expect(info_dictionary['name']).to.eql(Buffer.from(path.basename(temp_dir.name)))
        expect(info_dictionary['files'].length).to.eql(2)
    })
})
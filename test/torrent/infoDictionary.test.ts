import {expect, assert} from 'chai'
import {BencodeDict} from '../../src/bencode/types'
import  * as infoDictionary from '../../src/torrent/infoDictionary'
import * as tmp from 'tmp'
import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'

type ListedFiles = {files: string[], filesSize: number[], totalSize: number, pieceSize: number}

describe('Test Info Dictionary function', () => {
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

    it('should create info dictionary for single File', async() => {
        const data1: Buffer = crypto.randomBytes(10)
        const file1_path: string = `${temp_dir.name}${path.sep}file1.bin`
        fs.writeFileSync(file1_path, data1)
        const info_dictionary: BencodeDict = await infoDictionary.createInfoDictSingleFile(file1_path)
        
        expect(info_dictionary).to.be.instanceof(BencodeDict)
        const dict_value: {[key: string]: any} = info_dictionary.get()
        const keys: string[] = Object.keys(dict_value)
        expect(keys.sort()).to.eql(['length', 'name', 'piece length', 'pieces'])
        expect(dict_value['name'].toString()).to.equal('file1.bin')
        expect(dict_value['length']).to.equal(10)
    })

    it('should list all the files present in some directory', async() => {
        const data2: Buffer = crypto.randomBytes(20)
        fs.mkdirSync(`${temp_dir.name}${path.sep}dir1`)
        const file2_path: string = `${temp_dir.name}${path.sep}dir1${path.sep}file2.bin`
        fs.writeFileSync(file2_path, data2)
        
        const all_files_list: ListedFiles = await infoDictionary.listFilesInDirectory(temp_dir.name)
        const {files, filesSize, totalSize, pieceSize} = all_files_list
        expect(files.sort()).to.deep.equal(['dir1/file2.bin', 'file1.bin'])
        expect(filesSize.sort()).to.eql([10, 20])
        expect(pieceSize).to.equal(2)
        expect(totalSize).to.equal(30)
    })

    it('should create info dictionary for a directory', async() => {
        const file1_path: string = `${temp_dir.name}${path.sep}file1.bin`
        const file2_path: string = `${temp_dir.name}${path.sep}dir1${path.sep}file2.bin`
        const properties: ListedFiles = {
            files: [
                'dir1/file2.bin',
                'file1.bin'
            ],
            filesSize : [
                20,
                10
            ],
            pieceSize : 2,
            totalSize : 30
        }
        const info_dictionary: BencodeDict = await infoDictionary.createInfoDictMultipleFiles(temp_dir.name, properties)
        expect(info_dictionary).to.be.instanceof(BencodeDict)
        const dict_value: {[key: string]: any} = info_dictionary.get()
        const keys: string[] = Object.keys(dict_value)
        expect(keys.sort()).to.eql(['files', 'name', 'piece length', 'pieces'])
        expect(dict_value['name'].toString()).to.equal(path.basename(temp_dir.name))
        expect(dict_value['files']).to.be.instanceof(Array)
        const files : Object[] = dict_value['files']
        const expectedFile1: Object = {
            length: 20,
            path: [
                Buffer.from('dir1'),
                Buffer.from('file2.bin')
            ]
        }
        const expectedFile2: Object = {
            length: 10,
            path: [
                Buffer.from('file1.bin')
            ]
        }
        expect(files).to.deep.equal([expectedFile1, expectedFile2])
    })
})
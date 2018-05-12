import * as Bencode from '../../src/bencode/utils'
import {expect, assert} from 'chai'
import {BencodeList, BencodeString, BencodeInt, BencodeDict, BencodeToken} from '../../src/bencode/types'
import {Either} from 'monet'
import * as tmp from 'tmp'

describe('Test Bencode Utils function', () => {
    it('should detect a bencode string token properly', () => {
        const data: Buffer = Buffer.from('5:hello')
        const token: Either<Error, BencodeToken> = Bencode.decode(data)
        assert(token.isRight())
        expect(token.right()).to.be.instanceof(BencodeString)
        expect(token.right().value).to.deep.equal(Buffer.from('hello'))
    })

    it('should reject an error because length prefix is incompatible with token length', () => {
        const data: Buffer = Buffer.from('2:hello')
        const data2: Buffer = Buffer.from('7:hello')
        const token: Either<Error, BencodeToken> = Bencode.decode(data)
        const token2: Either<Error, BencodeToken> = Bencode.decode(data2)
        assert(token.isLeft())
        assert(token2.isLeft())
    })
    
    it('should detect a bencode int token properly', () => {
        const data: Buffer = Buffer.from('i128e')
        const token: Either<Error, BencodeToken> = Bencode.decode(data)
        assert(token.isRight())
        expect(token.right()).to.be.instanceof(BencodeInt)
        expect(token.right().value).to.equal(128)
    })

    it('should reject an error because missing final token character', () => {
        const data: Buffer = Buffer.from('i128d')
        const data2: Buffer = Buffer.from('i128')
        const token: Either<Error, BencodeToken> = Bencode.decode(data)
        const token2: Either<Error, BencodeToken> = Bencode.decode(data2)
        assert(token.isLeft())
        assert(token2.isLeft())
    })

    
    it('should detect a bencode list token properly', () => {
        const data: Buffer = Buffer.from('l5:helloi128ee')
        const token: Either<Error, BencodeToken> = Bencode.decode(data)
        assert(token.isRight(), '')
        expect(token.right()).to.be.instanceof(BencodeList)
        
        const first_token: BencodeToken = token.right().value[0]
        const second_token: BencodeToken = token.right().value[1]
        expect(first_token).to.be.instanceof(BencodeString)
        expect(first_token.value).to.deep.equal(Buffer.from('hello'))
        expect(second_token).to.be.instanceof(BencodeInt)
        expect(second_token.value).to.equal(128)
        
    })

    
    it('should reject an error because length missing final token character', () => {
        const data: Buffer = Buffer.from('l5:helloi128e')
        const token: Either<Error, BencodeToken> = Bencode.decode(data)
        assert(token.isLeft())
    })

    it('should detect a bencode dict token properly', () => {
        const data: Buffer = Buffer.from('d4:listl5:helloi128eee')
        const token: Either<Error, BencodeToken> = Bencode.decode(data)
        assert(token.isRight())
        expect(token.right()).to.be.instanceof(BencodeDict)
        const keys: string[] = Object.keys(token.right().value)
        expect(keys).to.deep.equal(['list'])
        const listToken: BencodeToken = token.right().value['list']
        expect(listToken).to.be.instanceof(BencodeList)
        expect(listToken.value[0].value).to.deep.equal(Buffer.from('hello'))
        expect(listToken.value[1].value).to.deep.equal(128)
    })

   it('should encode a bencode int properly', () => {
        const token: number = 18
        const expectedEncodedToken: Buffer = Buffer.from('i18e')
        const actualEncodedToken: Buffer = Bencode.encode(token)
        expect(actualEncodedToken).to.deep.equal(expectedEncodedToken)
    })

    it('should encode a bencode string properly', () => {
        const token: string = 'hello'
        const expectedEncodedToken: Buffer = Buffer.from('5:hello')
        const actualEncodedToken: Buffer = Bencode.encode(token)
        expect(actualEncodedToken).to.deep.equal(expectedEncodedToken)
    })

    it('should encode a bencode list properly', () => {
        const token: any[] = [
            "hello",
            128,
        ]
        const expectedEncodedToken: Buffer = Buffer.from('l5:helloi128ee')
        const actualEncodedToken: Buffer = Bencode.encode(token)
        expect(actualEncodedToken).to.deep.equal(expectedEncodedToken)
    })

    it('should encode a bencode dict properly', () => {
        const token: Object = {
            key1 : 'hello',
            key2 : 128
        }
        const expectedEncodedToken: Buffer = Buffer.from('d4:key15:hello4:key2i128ee')
        const actualEncodedToken: Buffer = Bencode.encode(token)
        expect(actualEncodedToken).to.deep.equal(expectedEncodedToken)
    })

    it('should encode a bencode complex structure properly', () => {
        const token: Object = {
            key1 : 'hello',
            key2 : 128,
            key3 : [
                'hello',
                128
            ]
        }
        const expectedEncodedToken: Buffer = Buffer.from('d4:key15:hello4:key2i128e4:key3l5:helloi128eee')
        const actualEncodedToken: Buffer = Bencode.encode(token)
        expect(actualEncodedToken).to.deep.equal(expectedEncodedToken)
    })

    it('should encode a bencode token to a file properly', async () => {
        const token: string = "hello"
        const tmpFile: tmp.SynchrounousResult = tmp.fileSync()
        const bytesWritten: number = await Bencode.encode_to_file(token, tmpFile.name)
        expect(bytesWritten).to.equal(7)
        tmpFile.removeCallback()
    })

    it('should retrieve a nested dictionary as a Javascript object', () => {
        const dict1: BencodeDict = new BencodeDict({})
        const dict2: BencodeDict = new BencodeDict({})
        dict1.putContent('key1', 1)
        dict1.putContent('key2', ['elem1', 'elem2'])
        dict2.putContent('nestedKey1', 'NK1')
        dict1.putContent('dict', dict2)
        const expectedResult = {
            key1 : 1,
            key2 : [Buffer.from('elem1'), Buffer.from('elem2')],
            dict : {
                'nestedKey1' : Buffer.from('NK1')
            }
        }
        const actualResult = dict1.get()
        expect(actualResult).to.deep.equal(expectedResult)
    })


    
})
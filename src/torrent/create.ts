import {BencodeDict} from '../bencode/types'
import * as InfoDictionaryUtils from './infoDictionary'
import * as fs from 'fs'
import * as path from 'path'
import {Either, Right, Left} from 'monet'
import {TorrentProperties} from './types'


export default async (properties: TorrentProperties): Promise<Either<Error, BencodeDict>> => {
    const {filepath, announce, comment} = properties
    const announce_list = (() => {
        if (properties['announce_list'].length > 0){
          return properties['announce_list'].split(';').map((element) => element.split(' '))
        } else {
          return []
        }
      })()
    try {
        const stats: fs.Stats = fs.statSync(filepath)
        const isDirectory: boolean = !stats.isFile()
        const info_dictionary: BencodeDict = await InfoDictionaryUtils.create(filepath, isDirectory)
        const result: BencodeDict = new BencodeDict({})
        result.putContent('announce', announce)
        result.putContent('announce-list', announce_list)
        result.putContent('comment', comment)
        result.putContent('created by', 'nhyne');
        result.putContent('creation date', Math.round(Date.now()/1000));
        result.putContent('encoding', 'utf-8');
        result.putContent('info',info_dictionary);
        return Right(result)
    } catch(e){
        return Left(new Error(e))
    }
    
}
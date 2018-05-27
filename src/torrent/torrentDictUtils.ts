import { BencodeDict, BencodeString } from "../bencode/types";
import { TorrentDict } from "./types";
import { Maybe, None } from 'monet'
import * as R from 'ramda'
import {logger} from '../logging/logger'

const TORRENT_DICT_KEYS: string[] = [
    'announce',
    'announce-list',
    'created by',
    'encoding',
    'creation date',
    'comment',
    'info'
]

export const convertBencodeDictInTorrentDict = (bdict: BencodeDict|object): Maybe<TorrentDict> => {
    const dictAsJSObject = (() => {
        if (bdict instanceof BencodeDict){
            return bdict.get()
        } else {
            bdict
        }
    })()
    const predicates = R.where({
        'announce' : R.is(Buffer),
        'announce-list' : R.is(Array),
        'info' : (elem) => R.is(Object, elem) && checkInfoDict(elem)
    })
    if(predicates(dictAsJSObject)){
        const torrentDict = <TorrentDict> R.pipe(
            convertBencodeDictValues(['pieces']),
            R.pick(TORRENT_DICT_KEYS)
        )(dictAsJSObject)
        return Maybe.Some(torrentDict)
    } else {
        return None()
    }
}

export const checkInfoDict = (token): Boolean => {
    if ('files' in token){
        return checkInfoDictMultipleFiles(token)
    } else {
        return checkInfoDictSingleFile(token)
    }
}

export const checkInfoDictMultipleFiles = (infoDict: Object): Boolean => {
    const predicates = R.where({
        'piece length' : R.is(Number),
        'pieces': R.is(Buffer),
        'name': R.is(Buffer),
        'files': checkFiles
    })
    return predicates(infoDict)
}

 export const checkFiles = (files): Boolean => {
    const predicates = R.where({
        'length' : R.is(Number),
        'path' : R.is(Array)
    })
    return R.all(predicates)(files)
} 

export const checkInfoDictSingleFile = (infoDict: Object): Boolean => {
    const predicates = R.where({
        'pieces' : R.is(Buffer),
        'piece length': R.is(Number),
        'name': R.is(Buffer),
        'length': R.is(Number)
    })
    return predicates(infoDict)
}

export const convertBencodeDictValues = (keysToExclude: string[]) => (bencodedDict: object): object => {
    return R.mapObjIndexed((value, key, obj) => {
        const isABuffer = Buffer.isBuffer(value)
        if (isABuffer && !R.contains(key, keysToExclude)){
            return value.toString()
        } else {
            const isAList = Array.isArray(value)
            if (isAList){
                return convertBencodeListValues(keysToExclude)(value)
            } else {
                const isADict = !isABuffer && !isAList && (value instanceof Object)
                if (isADict){
                    return convertBencodeDictValues(keysToExclude)(value)
                }
                return value
            }
        }
    })(bencodedDict)
}

export const convertBencodeListValues = (keysToExclude: string[]) => (bencodedList): Array<any> => {
    return R.map((value) => {
        const isABuffer = Buffer.isBuffer(value)
        if (isABuffer){
            return value.toString()
        } else {
            const isAList = Array.isArray(value)
            if (isAList){
                return convertBencodeListValues(keysToExclude)(value)
            } else {
                const isADict = !isABuffer && !isAList && (value instanceof Object)
                if (isADict){
                    return convertBencodeDictValues(keysToExclude)(value)
                }
                return value
            }
        }
    })(bencodedList);
};


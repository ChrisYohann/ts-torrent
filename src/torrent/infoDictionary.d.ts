import {BencodeDict} from '../bencode/types'
import {TorrentProperties} from './types'

export declare const listFilesInDirectory: (path: string) => Promise<{files: string[], filesSize: number[], totalSize: number, pieceSize: number}>
export declare const createInfoDictMultipleFiles: (path_directory: string, fileInfos: {files: string[], filesSize: number[], totalSize: number, pieceSize: number}) => Promise<BencodeDict>
export declare const createInfoDictSingleFile: (filepath: string) => Promise<BencodeDict>
export declare const create: (path: string, isDirectory: boolean) => Promise<BencodeDict>

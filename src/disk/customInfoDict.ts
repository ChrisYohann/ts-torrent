import { FileInfo } from "./types";
import * as R from 'ramda'

export class CustomInfoDictCommon {
    piece_length : number
    pieces : Buffer
    name : string
    totalSize : number
    nbPieces: number
    files : {
        "length" : number,
        "path" : string
    }[]

    constructor(name: string, files: {"length": number, "path": string}[], piece_length: number, pieces: Buffer){
        this.name = name
        this.files = files
        this.piece_length = piece_length
        this.pieces = pieces
        this.totalSize = this.computeTotalSize()
        this.nbPieces = this.computeNbPieces()
    }
    
    protected computeNbPieces(): number {
        return this.pieces.length/20
    }
    
    computeLastPieceLength(): number {
        const totalSize: number = this.totalSize
        const pieceLength: number = this.nbPieces
        return totalSize % pieceLength == 0 ? pieceLength : totalSize % pieceLength
    }
    
    computeTotalSize(): number {
        return R.sum(this.files.map(file => file.length))
    }

    getFilesInfos(): {path: string, length: number}[] {
        return this.files
    }
}
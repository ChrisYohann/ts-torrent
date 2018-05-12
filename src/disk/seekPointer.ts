export default class SeekPointer {
    readonly file_descriptor: number
    readonly file_offset : number
    readonly piece_offset : number
    readonly file_length: number
    
    constructor(fd: number, offset_file: number, offset_piece: number, file_length: number){
        this.file_descriptor = fd
        this.file_offset = offset_file
        this.piece_offset = offset_piece
        this.file_length = file_length
    }
}
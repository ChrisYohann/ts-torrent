import { BencodeString, BencodeList, BencodeInt } from "../bencode/types";

export type FileDescriptor = number

export interface FileInfo {
    fd : FileDescriptor
    path : string
    length : number
}
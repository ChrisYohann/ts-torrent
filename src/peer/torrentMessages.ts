import * as util from 'util'

export abstract class TorrentMessage {
    index: number = 0
    begin: number = 0
    length: number = 0

    lengthPrefix: number
    messageID: number
    payload: Buffer

    constructor(){

    }

    build(): Buffer {
        const buffer = Buffer.alloc(5);
        buffer.writeInt32BE(this.lengthPrefix, 0);
        if(this.messageID){
            buffer[4] = this.messageID;
        }
        if(this.payload){
            return Buffer.concat([buffer, this.payload]);
        }
        return buffer
    }
}

export class KeepAlive extends TorrentMessage {
    constructor(){
        super()
    }
}

export class Choke extends TorrentMessage {
    constructor(){
        super()
        this.lengthPrefix = 1;
        this.messageID = 0;
    }
}

export class Unchoke extends TorrentMessage {
    constructor(){
        super()
        this.lengthPrefix = 1;
        this.messageID = 1;
    }
}

export class Interested extends TorrentMessage {
    constructor(){
        super()
        this.lengthPrefix = 1;
        this.messageID = 2;
    }
}

export class NotInterested extends TorrentMessage {
    constructor(){
        super()
        this.lengthPrefix = 1;
        this.messageID = 3;
    }
}

export class Have extends TorrentMessage {
    constructor(pieceIndex: number){
        super()
        this.lengthPrefix = 5;
        this.messageID = 4;
        this.index = pieceIndex;
        const payload = Buffer.alloc(4);
        payload.writeInt32BE(pieceIndex, 0);
        this.payload = payload;
    }
}

export class Bitfield extends TorrentMessage {
    constructor(bitfield: Buffer){
        super()
        this.lengthPrefix = 1 + bitfield.length;
        this.messageID = 5;
        this.payload = bitfield;
    }
}

export class Request extends TorrentMessage {
    constructor(index: number, begin: number, length: number){
        super()
        this.lengthPrefix = 13;
        this.messageID = 6;
        this.index = index;
        this.begin = begin;
        this.length = length;
        const payload = Buffer.alloc(12);
        payload.writeInt32BE(index, 0);
        payload.writeInt32BE(begin, 4);
        payload.writeInt32BE(length, 8);
        this.payload = payload;
    }
}

export class Cancel extends TorrentMessage {
    constructor(index: number, begin: number, length: number){
        super()
        this.lengthPrefix = 13;
        this.messageID = 8;
        this.index = index;
        this.begin = begin;
        this.length = length;
        const payload = Buffer.alloc(12);
        payload.writeInt32BE(index, 0);
        payload.writeInt32BE(begin, 4);
        payload.writeInt32BE(length, 8);
        this.payload = payload;
    }
}

export class Piece extends TorrentMessage {
    constructor(index: number, begin: number, block: Buffer){
        super()
        this.lengthPrefix = 9 + block.length;
        this.messageID = 7;
        this.index = index;
        this.begin = begin;
        this.length = block.length;
        const firstPartPayload = Buffer.alloc(8);
        firstPartPayload.writeInt32BE(index, 0);
        firstPartPayload.writeInt32BE(begin, 4);
        this.payload = Buffer.concat([firstPartPayload, block]);
    }
}





import MessagesHandler from './messagesHandler'
import * as util from 'util'
import { EventEmitter } from 'events'
import * as R from 'ramda'
import * as _ from 'underscore'
import * as Utils from '../utils/utils'
import {
    TorrentMessage,
    Choke,
    Unchoke,
    Interested,
    NotInterested,
    Have,
    Bitfield,
    Request,
    Piece,
    Cancel,
    KeepAlive
} from './torrentMessages'
import { Socket } from 'net';

const Queue = require('queue');

export default class Peer extends EventEmitter {
    
    torrent
    peerId: Buffer
    socket: Socket

    am_choking: boolean
    am_interested: boolean
    peer_choking: boolean
    peer_interested: boolean

    messageQueue: any
    nbPiecesCurrentlyDownloading: number
    peer_bitfield: Buffer

    messageParser: MessagesHandler

    constructor(torrent, socket: Socket, peerId?: Buffer){
        super()
        this.torrent = torrent;
        this.peerId = peerId;
        this.socket = socket;

        //Status Fields
        this.am_choking = true;
        this.am_interested = false;
        this.peer_choking = true;
        this.peer_interested = false;

        this.messageQueue = new Queue({autostart: true});
        this.nbPiecesCurrentlyDownloading = 0;

        this.peer_bitfield = null;
        this.messageParser = peerId ? new MessagesHandler() : new MessagesHandler(true)
        this.initListeners();
        this.socket.on("data", this.messageParser.parse);
    }

    private initListeners(): void {
        let self = this;
        self.on("keepAlive", receiveKeepAlive.bind(self));
        self.on("choke", receiveChoke.bind(self));
        self.on("unchoke", receiveUnchoke.bind(self));
        self.on("interested", receiveInterested.bind(self));
        self.on("notInterested", receiveNotInterested.bind(self));
        self.on("have", receiveHave.bind(self));
        self.on("bitfield", receiveBitfield.bind(self));
        self.on("request", receiveRequest.bind(self));
        self.on("piece", receivePiece.bind(self));
        self.on("cancel", receiveCancel.bind(self));
    };

    addMessageToQueue(message: TorrentMessage){
        let self = this;
        const messageID = message.messageID;
        if(messageID != null){
            switch(messageID){
                case 0:
                    self.messageQueue.push(function(cb){
                        self.am_choking = true;
                        self.socket.write(message.build(), () => {cb()});
                    });
                    break;
                case 1:
                    self.messageQueue.push(function(cb){
                        self.am_choking = false;
                        self.socket.write(message.build(), () => {cb()});
                    });
                    break;
                case 2:
                    self.messageQueue.push(function(cb){
                        self.am_interested = true;
                        self.socket.write(message.build(), () => {cb()});
                    });
                    break;
                case 3:
                    self.messageQueue.push(function(cb){
                        self.am_interested = false;
                        self.socket.write(message.build(), () => {cb()});
                    });
                    break;
                default:
                    self.messageQueue.push(function(cb){
                        self.socket.write(message.build(), () => {cb()});
                    });
                    break;
            }
        }
    };

    requestPiece(pieceIndex: number): void {
        let self = this;
        const requestMessages = self.createRequestMessages(pieceIndex);
        requestMessages.forEach((request) => {
            self.addMessageToQueue(request);
        });
    };

    containsPiece(pieceIndex: number): boolean {
        if (this.peer_bitfield != null){
            return Utils.bitfieldContainsPiece(this.peer_bitfield, pieceIndex);
        } else {
            return false;
        }
    }

    private createRequestMessages(pieceIndex: number, lengthBlock?:number): Request[]{
        let self = this;
        const blockLength = lengthBlock? lengthBlock : 1 << 14;
        const isLastPiece = pieceIndex == self.torrent.nbPieces-1;
        const blockRequests = ((isLastPiece) => {
            if(isLastPiece)
                return createBlockRequests(self.torrent.lastPieceLength, Math.min(blockLength, self.torrent.lastPieceLength));
            else
                return createBlockRequests(self.torrent.pieceLength, Math.min(blockLength, self.torrent.pieceLength));
        })(isLastPiece);
        const requests = R.map((block: {begin: number, length: number}) => {
            return new Request(pieceIndex, block.begin, block.length);
        })(blockRequests);
        return requests;
    };

}

const receiveKeepAlive = () => {

};

const receiveChoke = () => {
    let self = this;
    self.peer_choking = true;
};

const receiveUnchoke = () => {
    let self = this;
    self.peer_choking = false;
};

const receiveInterested = () => {
    let self = this;
    self.peer_interested = true;
};

const receiveNotInterested = () => {
    let self = this;
    self.peer_interested = false;
};

const receiveHave = (pieceIndex: number) => {
    let self = this;
    self.peer_bitfield = Utils.updateBitfield(self.peer_bitfield, pieceIndex);
};

const receiveBitfield = (bitfield: Buffer) => {
    let self = this;
    self.peer_bitfield = bitfield;
};

const receiveRequest = (index: number, begin: number, length: number) => {
    let self = this;
    if(self.torrent.containsPiece(index)){
        self.torrent.read(index, begin, length).then(function(chunk){
            const message = new Piece(index, begin, chunk);
            self.addMessageToQueue(message);
        });
    }
};

const receivePiece = (index: number, begin: number, block: Buffer) => {
    let self = this;
    if(self.torrent.containsPiece(index)){
        self.torrent.write(index, begin, block).then(function(isCompleted){
            if (isCompleted){
                self.nbPiecesCurrentlyDownloading -= 1 ;
                self.emit("have", index);
            }
        });
    }
};

const receiveCancel = (index: number, begin: number, length: number) => {
    let self = this;
    //self.torrent.cancel(index, begin, length)
};

const createBlockRequests = (pieceLength, blockLength){
    const beginValues = _.range(0, pieceLength, blockLength);
    const blockValues = _.map(beginValues, (blockBegin, index) => {
        if (index == beginValues.length - 1)
            return {begin: blockBegin, length: pieceLength - blockBegin};
        else
            return {begin: blockBegin, length: blockLength};
    });
    return blockValues;
};


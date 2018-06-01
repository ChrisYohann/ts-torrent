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
import { Socket, createConnection } from 'net'
import { Torrent } from '../Torrent/torrent'
import { logger } from '../logging/logger'
import { INVALID_PEER, PEER_ID_RECEIVED, CONNECTION_SUCCESSFUL } from '../events/events'
import { randomBytes } from 'crypto'
import * as Handshake from '../peer/handshake'


const Queue = require('queue')

export interface InitiateConnectionParams {
    host: string
    port: number
}

export interface ReceivingConnectionParams {
    socket: Socket
    peerId?: Buffer
}

export type ConnectionParams = InitiateConnectionParams | ReceivingConnectionParams

const instanceOfInitiateConnectionParams = (params: ConnectionParams): params is InitiateConnectionParams => 'host' in params

export class Peer extends EventEmitter {
    
    torrent: Torrent
    peerId: Buffer
    socket: Socket
    remoteAddress: string

    am_choking: boolean
    am_interested: boolean
    peer_choking: boolean
    peer_interested: boolean

    messageQueue: any
    nbPiecesCurrentlyDownloading: number
    peer_bitfield: Buffer

    messageParser: MessagesHandler

    constructor(torrent: Torrent, params: ConnectionParams){
        super()
        const self = this
        this.torrent = torrent

        //Status Fields
        this.am_choking = true
        this.am_interested = false
        this.peer_choking = true
        this.peer_interested = false

        this.messageQueue = new Queue({autostart: true})
        this.nbPiecesCurrentlyDownloading = 0

        this.peer_bitfield = null
        //this.messageParser = peerId ? new MessagesHandler() : new MessagesHandler(true)

        logger.verbose(`Is instance of initiate connection ${'host' in params}`)
        if (instanceOfInitiateConnectionParams(params)){
            const socket = new Socket()
            
            this.messageParser = new MessagesHandler(torrent.infoHash, true)
            this.messageParser.on(PEER_ID_RECEIVED, (peerId: Buffer) => {
                this.peerId = peerId
                this.emit(CONNECTION_SUCCESSFUL)
            })
            this.messageParser.on(INVALID_PEER, () => {
                this.emit(INVALID_PEER)
                socket.end()
            })
            this.initListeners()
            
            const timer = setTimeout(() => {
                logger.verbose(`Timeout of 10 seconds exceeded. Aborting Connection.`)
                socket.destroy()
                this.emit(INVALID_PEER)
            }, 5000)

            const { host, port } = params
            logger.verbose(`Connecting to ${host} at port ${port} for ${torrent.name}`)
            socket.on('error', (err: Error) => {
                logger.error(err.message)
                socket.destroy()
                this.emit(INVALID_PEER)
            })

            socket.connect(params, () => {
                logger.verbose(`Connected to ${socket.remoteAddress}`)
                this.socket = socket

                socket.once('data', (data: Buffer) => {
                    clearTimeout(timer)
                })

                socket.on('data', (data: Buffer) => {
                    logger.verbose(`Received ${data.length} bytes from ${socket.remoteAddress}`)
                    this.messageParser.parse(data)
                })
                const handshake: Buffer = Handshake.build(torrent.infoHash, randomBytes(20))
                logger.verbose(`Handshake Length : ${handshake.length}`)
                logger.verbose(`Handshake : ${handshake.toString('hex')}`)
                socket.write(handshake, 'utf8', () => {
                logger.verbose(`Handshake sent to ${socket.remoteAddress}`)
                })
            })  
        }
    }

    private initListeners(): void {
        this.messageParser.on('peerId', (peerId: Buffer) => this.peerId = peerId)
        this.messageParser.on('keepAlive', this.receiveKeepAlive.bind(this))
        this.messageParser.on('choke', this.receiveChoke.bind(this))
        this.messageParser.on('unchoke', this.receiveUnchoke.bind(this))
        this.messageParser.on('interested', this.receiveInterested.bind(this))
        this.messageParser.on('notInterested', this.receiveNotInterested.bind(this))
        this.messageParser.on('have', this.receiveHave.bind(this))
        this.messageParser.on('bitfield', this.receiveBitfield.bind(this))
        this.messageParser.on('request', this.receiveRequest.bind(this))
        this.messageParser.on('piece', this.receivePiece.bind(this))
        this.messageParser.on('cancel', this.receiveCancel.bind(this))
    }

    addMessageToQueue(message: TorrentMessage){
        let self = this
        const messageID = message.messageID
        logger.debug(`Message ID to Add to Queue : ${messageID}`)
        if(messageID != null){
            switch(messageID){
                case 0:
                    self.messageQueue.push(function(cb){
                        self.am_choking = true
                        self.socket.write(message.build(), () => {cb()})
                    })
                    break
                case 1:
                    self.messageQueue.push(function(cb){
                        self.am_choking = false
                        self.socket.write(message.build(), () => {cb()})
                    })
                    break
                case 2:
                    self.messageQueue.push(function(cb){
                        self.am_interested = true
                        self.socket.write(message.build(), () => {cb()})
                    })
                    break
                case 3:
                    self.messageQueue.push(function(cb){
                        self.am_interested = false
                        self.socket.write(message.build(), () => {cb()})
                    })
                    break
                default:
                    self.messageQueue.push(function(cb){
                        self.socket.write(message.build(), () => {
                            cb()})
                    })
                    break
            }
        }
    }

    start(): void {
        this.sendUnchoke()
        this.sendBitfield(this.torrent.bitfield)
        if (!this.torrent.isCompleted()){
            this.sendInterested()
        }
    }

    sendUnchoke(): void {
        logger.debug(`Sending Unchoke to ${this.socket.remoteAddress}`)
        this.addMessageToQueue(new Unchoke())
        this.am_choking = false
    }

    sendInterested(): void {
        logger.debug(`Sending Interested to ${this.socket.remoteAddress}`)
        this.addMessageToQueue(new Interested())
        this.am_interested = true
    }

    sendBitfield(bitfield: Buffer): void {
        logger.debug(`Sending Bitfield to ${this.socket.remoteAddress}`)
        this.addMessageToQueue(new Bitfield(bitfield))
    }

    sendRequest(pieceIndex: number): void {
        logger.debug(`Sending Request to ${this.socket.remoteAddress} for piece ${pieceIndex}`)
        const requestMessages = this.createRequestMessages(pieceIndex)
        requestMessages.forEach((request) => {
            this.addMessageToQueue(request)
        })
    }

    sendHave(pieceIndex: number): void {
        logger.debug(`Sending Have to ${this.socket.remoteAddress} for piece ${pieceIndex}`)
        this.addMessageToQueue(new Have(pieceIndex))
    }

    containsPiece(pieceIndex: number): boolean {
        if (this.peer_bitfield != null){
            return Utils.bitfieldContainsPiece(this.peer_bitfield, pieceIndex)
        } else {
            return false
        }
    }

    private createRequestMessages(pieceIndex: number, lengthBlock?:number): Request[]{
        let self = this
        const blockLength = lengthBlock? lengthBlock : 1 << 14
        const isLastPiece = pieceIndex == self.torrent.nbPieces-1
        const blockRequests = ((isLastPiece) => {
            if(isLastPiece)
                return createBlockRequests(self.torrent.getLastPieceLength(), Math.min(blockLength, self.torrent.getLastPieceLength()))
            else
                return createBlockRequests(self.torrent.pieceLength, Math.min(blockLength, self.torrent.pieceLength))
        })(isLastPiece)
        const requests = R.map((block: {begin: number, length: number}) => {
            return new Request(pieceIndex, block.begin, block.length)
        })(blockRequests)
        return requests
    }

    private receiveKeepAlive() {

    }

    private receiveChoke() {
        this.peer_choking = true
    }

    private receiveUnchoke() {
        this.peer_choking = false
        this.emit('unchoked')
    }

    private receiveInterested() {
        this.peer_interested = true
    }

    private receiveNotInterested() {
        this.peer_interested = false
    }

    private receiveHave(pieceIndex: number) {
        this.peer_bitfield = Utils.updateBitfield(this.peer_bitfield, pieceIndex)
    }

    private receiveBitfield(bitfield: Buffer){
        this.peer_bitfield = bitfield
    }

    private receiveRequest(index: number, begin: number, length: number) {
        if(this.torrent.containsPiece(index)){
            this.torrent.read(index, begin, length).then(function(chunk){
                const message = new Piece(index, begin, chunk)
                this.addMessageToQueue(message)
            })
        }
    }

    private async receivePiece(index: number, begin: number, block: Buffer) {
        if(!this.torrent.containsPiece(index)){
            const isPieceCompleted: boolean = await this.torrent.write(index, begin, block)
            if (isPieceCompleted){
                this.nbPiecesCurrentlyDownloading -= 1
            }
        }
    }

    private receiveCancel(index: number, begin: number, length: number) {
        let self = this
        //self.torrent.cancel(index, begin, length)
    }
}

const createBlockRequests = (pieceLength: number, blockLength: number): {begin: number, length: number}[] => {
    const beginValues = _.range(0, pieceLength, blockLength)
    const blockValues = _.map(beginValues, (blockBegin, index) => {
        if (index == beginValues.length - 1)
            return {begin: blockBegin, length: pieceLength - blockBegin}
        else
            return {begin: blockBegin, length: blockLength}
    })
    return blockValues
}


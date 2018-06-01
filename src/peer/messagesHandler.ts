import * as TorrentMessages from './torrentMessages'
import { logger } from '../logging/logger'
import * as util from 'util'
import { EventEmitter } from 'events'
import * as Handshake from './handshake'
import { Either, Right, Left, Maybe } from 'monet'
import { PEER_ID_RECEIVED, INVALID_PEER } from '../events/events'

const MESSAGE_ID_MAX = 9
const MESSAGE_ID_MIN = 0
const MESSAGE_MAX_LENGTH = (1<<14) + 13
const MESSAGE_MIN_LENGTH = 0

export enum handlerStatus {
  AWAIT_HANDSHAKE = 0,
  DECODING_LENGTH_PREFIX = 1,
  DECODING_PAYLOAD = 2
}


export default class MessagesHandler extends EventEmitter{
  infoHash: Buffer
  offset: number
  partialMessage: Buffer
  expectedLength: number
  partialStatus: handlerStatus

  constructor(infoHash: Buffer, waitingForPeerId?: boolean){
    super()
    this.infoHash = infoHash
    this.partialStatus = waitingForPeerId ? handlerStatus.AWAIT_HANDSHAKE : handlerStatus.DECODING_LENGTH_PREFIX
    this.clear(false)
  }
  
  parse(data: Buffer): TorrentMessages.TorrentMessage[] {
    const self = this
    let chunk: Buffer = data
    const result: TorrentMessages.TorrentMessage[] = []
    console.log(`Incoming Chunk. Length : ${data.length}`)
    console.log(`Incoming Chunk. Length : ${data.length}`)
    
    if (this.partialStatus === handlerStatus.AWAIT_HANDSHAKE){
      this.decodeHandshake(data).cata(
        (err: Error) => {
          console.log('Invalid handshake')
          this.emit(INVALID_PEER)
        },
        ({infoHash, peerId}) => {
          console.log('Handshake is Valid.')
          this.emit(PEER_ID_RECEIVED, peerId)
          chunk = chunk.slice(Handshake.HANDHSAKE_LENGTH)
          this.partialStatus += 1
        }
      )
    }

    while (chunk.length > 0){
      this.parsePartial(chunk).cata(
        ({partialMessage}) => {
          console.log('PartialMessage')
          chunk = Buffer.alloc(0)
        },
        ({message, buffer}) => {
          if (message.isSome()){
            result.push(message.some())
          }
          chunk = buffer
        }
      )
    }
    return result
  }

  private clear(resetStatus?: boolean): void {
    const newResetStatus: boolean = resetStatus ? resetStatus : false
    this.partialStatus = newResetStatus ? handlerStatus.DECODING_LENGTH_PREFIX : this.partialStatus
    this.partialMessage = Buffer.alloc(0)
    this.expectedLength = 0
  }

  private decodeHandshake(chunk: Buffer): Either<Error, {peerId: Buffer, infoHash: Buffer}>{
    logger.debug('Decoding Handshake')
    return Handshake.parse(chunk).cata(
      (err: Error) => {
        logger.error(`Error while decoding Handshake : ${err.message}`)
        return Left(err)
      },
      ({peerId, infoHash}) => {
        console.log('Handshake parsed without errors')
        if (infoHash.equals(this.infoHash)){
          return Right({peerId, infoHash})
        } else {
          const message = "Peer Id Info Hash and Torrent Info Hash do not match. Aborting"
          console.log(message)
          return Left(new Error(message))
        }
      }
    )
  }

  private parsePartial(data: Buffer): Either<{ partialMessage: Buffer }, { message : Maybe<TorrentMessages.TorrentMessage>, buffer: Buffer }> {
    let chunk = data
    console.log(`Partial Message Length : ${this.partialMessage.length}`)
    console.log(`Chunk Length : ${chunk.length}`)
    //console.log(``)
    if (this.partialStatus === handlerStatus.DECODING_LENGTH_PREFIX) {
      const remainingBytes: number = 4 - this.partialMessage.length
      const availableBytesLengthPrefix: number = chunk.length
      if (remainingBytes > availableBytesLengthPrefix){
        this.partialMessage = Buffer.concat([this.partialMessage, chunk])
        return Left({partialMessage: this.partialMessage})
      }
      this.partialMessage = Buffer.concat([this.partialMessage, chunk.slice(0, remainingBytes)])
      chunk = chunk.slice(remainingBytes)
      this.expectedLength = this.partialMessage.readInt32BE(0)
      console.log(`Expected length for next Message : ${this.expectedLength}`)
      this.partialStatus += 1
    }
    
    const availableBytesPayload = chunk.length
    const remainingBytesToParsePayload = this.expectedLength - this.partialMessage.length + 4
    
    console.log(`Avalailable bytes in payload : ${chunk.length}`)
    console.log(`Remaining Bytes to fully parse payload ${remainingBytesToParsePayload}`)
    
    if (remainingBytesToParsePayload > availableBytesPayload) {
      this.partialMessage = Buffer.concat([this.partialMessage, chunk])
      return Left({partialMessage: this.partialMessage})
    }

    this.partialMessage = Buffer.concat([this.partialMessage, chunk.slice(0, remainingBytesToParsePayload)])
    chunk = chunk.slice(remainingBytesToParsePayload)
    const message = this.parseMessage(this.partialMessage)
    return Right({message, buffer: chunk})
  }

  private parseMessage(chunk: Buffer): Maybe<TorrentMessages.TorrentMessage> {
    const lengthPrefix: number = chunk.readInt32BE(0)
    console.log("Length Prefix : "+lengthPrefix)
    
    if(lengthPrefix < MESSAGE_MIN_LENGTH || lengthPrefix > MESSAGE_MAX_LENGTH){
      logger.error("Error : Invalid length message for Decoding ("+lengthPrefix+")")
      this.clear()
      return Maybe.None()
    }
    
    if(lengthPrefix == 0){
      this.clear()
      this.emit("keepAlive")
      return Maybe.of(new TorrentMessages.KeepAlive())
    }

    const messageID = chunk[4]

    switch(messageID){
      case 0 :
          this.clear()
          this.emit("choke")
          return Maybe.of(new TorrentMessages.Choke())
      case 1 :
          this.clear()
          this.emit("unchoke")
          return Maybe.of(new TorrentMessages.Unchoke())
      case 2 :
          this.clear()
          this.emit("interested")
          return Maybe.of(new TorrentMessages.Interested())
      case 3 :
          this.clear()
          this.emit("notInterested")
          return Maybe.of(new TorrentMessages.NotInterested())
          case 4 :
          const pieceIndex = chunk.readInt32BE(5)
          console.log("Have : Index = " + pieceIndex)
          this.emit("have", pieceIndex)
          this.clear()
          return Maybe.of(new TorrentMessages.Have(pieceIndex))
      case 5 :
          const bitfieldBuffer = chunk.slice(5)
          this.emit("bitfield", bitfieldBuffer)
          console.log('Bitfield')
          this.clear()
          return Maybe.of(new TorrentMessages.Bitfield(bitfieldBuffer))
      case 6 :
          const indexRequest = chunk.readInt32BE(5)
          const beginRequest = chunk.readInt32BE(9)
          const lengthRequest = chunk.readInt32BE(13)
          console.log("Request : Index = " + indexRequest + " Begin : " + beginRequest + " Length : " + lengthRequest)
          this.clear()
          this.emit("request", indexRequest, beginRequest, lengthRequest)
          return Maybe.of(new TorrentMessages.Request(indexRequest, beginRequest, lengthRequest))
      case 7 :
          const indexPiece = chunk.readInt32BE(5)
          const beginPiece = chunk.readInt32BE(9)
          const block = chunk.slice(13)
          console.log(`Piece : Index = " + ${indexPiece} + " Begin : " + ${beginPiece} + " Length : ${chunk.length - 13}`)
          this.clear()
          this.emit("piece", indexPiece, beginPiece, block)
          return Maybe.of(new TorrentMessages.Piece(indexPiece, beginPiece, block))
     case 8 :
          const indexCancel = chunk.readInt32BE(5)
          const beginCancel = chunk.readInt32BE(9)
          const lengthCancel = chunk.readInt32BE(13)
          console.log("Cancel : Index = " + indexCancel + " Begin : " + beginCancel + " Length : " + lengthCancel)
          this.clear()
          this.emit("cancel", indexCancel, beginCancel, lengthCancel)
          return Maybe.of(new TorrentMessages.Cancel(indexCancel, beginCancel, lengthCancel))
      default :
          console.log("Message ID ("+messageID+") cannot be parsed")
          this.clear()
          return Maybe.None() 
    }
  }
}

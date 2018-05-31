import * as TorrentMessages from './torrentMessages'
import { logger } from '../logging/logger'
import * as util from 'util'
import { EventEmitter } from 'events'
import * as Handshake from './handshake'
import { Either, Right, Left } from 'monet'
import { PEER_ID_RECEIVED, INVALID_PEER } from '../events/events';

const MESSAGE_ID_MAX = 9;
const MESSAGE_ID_MIN = 0;
const MESSAGE_MAX_LENGTH = (1<<14) + 13;
const MESSAGE_MIN_LENGTH = 0;

const AWAIT_PEER_ID = 0;
const DECODING_LENGTH_PREFIX = 1;
const DECODING_BYTE_ID = 2;
const DECODING_PAYLOAD = 3;

export enum handlerStatus {
  AWAIT_HANDSHAKE = 0,
  DECODING_LENGTH_PREFIX = 1,
  DECODING_BYTE_ID = 2,
  DECODING_PAYLOAD = 3,
}


export default class MessagesHandler extends EventEmitter{
  infoHash: Buffer
  offset: number
  partialStatus: handlerStatus
  partialMessageID: number
  partialLengthPrefix: Buffer
  partialPayload: Buffer
  partialPeerID: Buffer

  constructor(infoHash: Buffer, waitingForPeerId?: boolean){
    super()
    this.infoHash = infoHash
    this.offset = 0
    this.partialStatus = waitingForPeerId ? handlerStatus.AWAIT_HANDSHAKE : handlerStatus.DECODING_LENGTH_PREFIX
    this.clear(false)
  }
  
  parse(chunk: Buffer): TorrentMessages.TorrentMessage[] {
    const self = this
    const result: TorrentMessages.TorrentMessage[] = []
    self.offset = 0
    logger.verbose(`Incoming Chunk. Length : ${chunk.length}`)
    if (this.partialStatus === handlerStatus.AWAIT_HANDSHAKE){
      this.decodeHandshake(chunk).cata(
        (err: Error) => {
          this.emit(INVALID_PEER)
        },
        ({infoHash, peerId}) => {
          this.emit(PEER_ID_RECEIVED, peerId)
          this.offset += infoHash.length
          this.partialStatus += 1
        }
      )
    }
    while(self.offset < chunk.length){
      const message: TorrentMessages.TorrentMessage = self.parseMessage(chunk, true);
      if(message){
        result.push(message);
      }
    }
    return result;
  }

  private clear(resetStatus?: boolean): void {
    const newResetStatus: boolean = resetStatus ? resetStatus : false;
    this.partialStatus = newResetStatus ? DECODING_LENGTH_PREFIX : this.partialStatus;
    this.partialMessageID = newResetStatus ? -1 : this.partialMessageID;
    this.partialLengthPrefix = Buffer.alloc(0);
    this.partialPayload = Buffer.alloc(0);
    //this.offset = 0
  }

  private parseMessage(chunk: Buffer, isPartial: boolean): TorrentMessages.TorrentMessage{
    let self = this;
    self.offset = isPartial ? 0 : self.offset;
    const status = self.partialStatus;
    logger.verbose("Status : "+status);
    try{
      switch(status){
        case handlerStatus.AWAIT_HANDSHAKE:
          const peerId = this.decodePeerID(chunk);
          self.emit('peerId', peerId)
        case handlerStatus.DECODING_LENGTH_PREFIX:
          const lengthPrefix = this.decodeLengthPrefix(chunk);
          logger.verbose("Length : "+lengthPrefix);
            if(lengthPrefix < MESSAGE_MIN_LENGTH || lengthPrefix > MESSAGE_MAX_LENGTH){
              logger.error("Error : Invalid length message for Decoding ("+lengthPrefix+")");
              self.clear();
              return null ;
            }
            if(lengthPrefix == 0){
              self.clear();
              self.emit("keepAlive")
              return new TorrentMessages.KeepAlive();
            }
        case handlerStatus.DECODING_BYTE_ID:
          const messageID = this.decodeMessageID(chunk);
          logger.verbose("Message ID : "+messageID);
        case handlerStatus.DECODING_PAYLOAD:
            switch(self.partialMessageID){
              case 0 :
                      self.clear();
                      self.emit("choke");
                      return new TorrentMessages.Choke();
              case 1 :
                      self.clear();
                      self.emit("unchoke");
                      return new TorrentMessages.Unchoke();
              case 2 :
                      self.clear();
                      self.emit("interested");
                      return new TorrentMessages.Interested();
              case 3 :
                      self.clear();
                      self.emit("notInterested");
                      return new TorrentMessages.NotInterested();
              default:
                      const payload = this.decodePayload(chunk);
                      const message = this.parsePayload(self.partialMessageID, payload);
                      self.clear();
                      return message;
            }
        default:
            self.clear();
            return null;
      }
    } catch(e){
      return null;
    }
  }

  private parsePayload(messageID: number, buffer: Buffer): TorrentMessages.TorrentMessage{
    let self = this;
    logger.verbose("Parsing Payload");
    let offset = 0;
    switch(messageID){
      case 4 :
          const pieceIndex = buffer.readInt32BE(offset);
          logger.verbose("Have : Index = " + pieceIndex);
          self.emit("have", pieceIndex);
          return new TorrentMessages.Have(pieceIndex);
      case 5 :
          const bitfieldBuffer = buffer.slice(offset);
          self.emit("bitfield", bitfieldBuffer);
          return new TorrentMessages.Bitfield(bitfieldBuffer);
      case 6 :
          const indexRequest = buffer.readInt32BE(offset);
          const beginRequest = buffer.readInt32BE(offset+4);
          const lengthRequest = buffer.readInt32BE(offset+8);
          logger.verbose("Request : Index = " + indexRequest + " Begin : " + beginRequest + " Length : " + lengthRequest);
          self.emit("request", indexRequest, beginRequest, lengthRequest);
          return new TorrentMessages.Request(indexRequest, beginRequest, lengthRequest);
      case 7 :
          const indexPiece = buffer.readInt32BE(offset);
          const beginPiece = buffer.readInt32BE(offset+4);
          const block = buffer.slice(offset+8);
          logger.verbose(`Piece : Index = " + ${indexPiece} + " Begin : " + ${beginPiece} + " Length : ${buffer.length-8}`);
          self.emit("piece", indexPiece, beginPiece, block);
          return new TorrentMessages.Piece(indexPiece, beginPiece, block);
     case 8 :
          const indexCancel = buffer.readInt32BE(offset);
          const beginCancel = buffer.readInt32BE(offset+4);
          const lengthCancel = buffer.readInt32BE(offset+8);
          logger.verbose("Cancel : Index = " + indexCancel + " Begin : " + beginCancel + " Length : " + lengthCancel);
          self.emit("cancel", indexCancel, beginCancel, lengthCancel);
          return new TorrentMessages.Cancel(indexCancel, beginCancel, lengthCancel);
      default :
          logger.verbose("Message ID ("+messageID+") cannot be parsed");
          return null ;
    }
  }

  private decodeHandshake(chunk: Buffer): Either<Error, {peerId: Buffer, infoHash: Buffer}>{
    return Handshake.parse(chunk).cata(
      (err: Error) => {
        logger.error(`Error while decoding Handshake : ${err.message}`)
        return Left(err)
      },
      ({peerId, infoHash}) => {
        logger.verbose('Handshake parsed without errors')
        if (infoHash.equals(this.infoHash)){
          return Right({peerId, infoHash})
        } else {
          const message = "Peer Id Info Hash and Torrent Info Hash do not match. Aborting"
          logger.verbose(message)
          return Left(new Error(message))
        }
      }
    )
  }

  private decodePeerID(chunk: Buffer): Buffer {
    let self = this;
    if(self.offset < chunk.length){
      const remainingBytes = 20 - self.partialPeerID.length;
      const otherPart = chunk.slice(self.offset, remainingBytes);
      self.partialPeerID = Buffer.concat([self.partialPeerID, otherPart]);
      self.offset += otherPart.length;
      if(self.partialPeerID.length == 20){
        self.partialStatus++ ;
        return self.partialPeerID;
      } else {
        let message = `Only ${self.partialPeerID.length} bytes for peerID. Waiting for next chunk.`
        logger.verbose(message);
        throw message;
      }
    } else {
      const message = `Only ${self.partialPeerID.length} bytes for peerID. Waiting for next chunk.`
      logger.verbose(message);
      throw message;
    }
  }

  private decodeLengthPrefix(chunk: Buffer): number {
    logger.verbose("Decoding Length Prefix");
    let self = this;
    if(self.offset < chunk.length){
      const remainingBytes = 4 - self.partialLengthPrefix.length;
      const otherPart = chunk.slice(self.offset, self.offset+remainingBytes);
      self.partialLengthPrefix = Buffer.concat([self.partialLengthPrefix, otherPart]);
      self.offset += otherPart.length;
      if(self.partialLengthPrefix.length == 4){
        self.partialStatus = DECODING_BYTE_ID;
        return self.partialLengthPrefix.readInt32BE(0);
      } else {
        let message = `Only ${self.partialLengthPrefix.length} bytes for lengthPrefix. Waiting for next chunk.`;
        logger.verbose(message);
        throw message;
      }
    } else {
      let message = "Unsufficient Bytes remaining in the socket to determine Length Prefix. Waiting For next chunk."
      logger.verbose(message);
      throw message ;
    }
  }

  private decodeMessageID(chunk: Buffer): number{
    let self = this;
    logger.verbose("Decoding Message ID");
    if(self.offset < chunk.length){
      const messageID = chunk[self.offset];
      self.partialMessageID = messageID ;
      self.offset += 1;
      self.partialStatus++ ;
      return messageID;
    } else {
      let message = "Unsufficient Bytes Remaining in the socket to determine messageID. Waiting For next chunk"
      logger.verbose(message);
      throw message ;
    }
  }
  
  private decodePayload(chunk: Buffer): Buffer {
    logger.verbose("Decoding Payload");
    let self = this;
    const payloadLength = self.partialLengthPrefix.readInt32BE(0) - 1;
    logger.verbose(`Chunk Length = ${chunk.length}, Offset = ${self.offset}, Expectedlength = ${payloadLength}`);
    if (self.offset < chunk.length){
      const remainingBytes = payloadLength - self.partialPayload.length;
      const otherPart = chunk.slice(self.offset, self.offset+remainingBytes);
      self.partialPayload = Buffer.concat([self.partialPayload, otherPart]);
      self.offset += otherPart.length;
      logger.verbose(`Partial Payload length = ${self.partialPayload.length}`);
      if(self.partialPayload.length == payloadLength){
        return self.partialPayload;
      } else {
        let message = "Unsufficient bytes to read in payload";
        logger.verbose(message);
        throw message;
      }
    } else {
      let message = "Unsufficient bytes to read in payload";
      logger.verbose(message);
      throw message;
    }
  }
}

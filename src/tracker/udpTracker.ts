import * as dgram from 'dgram'
import * as crypto from 'crypto'
import { logger } from '../logging/logger'
import * as Utils from '../utils/utils'
import * as util from 'util'
import * as url from 'url'
import { Tracker, TrackerResponse } from './tracker'
import { Torrent } from '../torrent/torrent'
import { resolve } from 'path'
import { Either, Left, Right } from 'monet'

const compact2string = require('compact2string')

const PROTOCOL_ID = 0x41727101980
const protocolIDBuffer = (() => {
  const buf = Buffer.allocUnsafe(8)
  buf.writeUInt32BE(0x417, 0)
  buf.writeUInt32BE(0x27101980, 4)
  return buf
})()
const CONNECT_ACTION = 0
const ANNOUNCE_ACTION = 1
const SCRAPE_ACTION = 2
const ERROR_ACTION = 3

const EVENTS = {
  'none' : 0,
  'completed' : 1,
  'started' : 2,
  'stopped' : 3
}

export class UDPTracker extends Tracker {
  transactionID: Buffer
  connectionID: Buffer
  server: dgram.Socket
  isServerBound: boolean
  
  
  constructor(announceURL: string, torrent: Torrent){
    super(announceURL, torrent)
    this.transactionID = crypto.randomBytes(4)
    const urlObject: url.UrlWithStringQuery = url.parse(announceURL)
    this.trackerURL = (urlObject.hostname == '0.0.0.0' ? '127.0.0.1' : urlObject.hostname)
    this.trackerPort = urlObject.port
    logger.verbose(`Tracker Infos : ${this.trackerURL}:${this.trackerPort}`)
  }
  
  bindServer(){
    return new Promise((resolve, reject) => {
      const server = dgram.createSocket('udp4')
      
      server.on('listening', () => {
        const serverAddress = server.address()
        const {address, port} = serverAddress
        logger.verbose(`Server listening ${address}:${port}`)
        this.server = server
        this.isServerBound = true
        resolve()
      })
      
      server.bind()
    })   
  }
  
  async announce(event: string): Promise<TrackerResponse> {
    if (!this.isServerBound){
      await this.bindServer()
    }
    return new Promise((resolve: (value: TrackerResponse) => void, reject) => {
      this.server.removeAllListeners('message')
      this.server.on('message', (message: Buffer, remote: dgram.RemoteInfo) => {
      logger.debug('Message received from : '+remote.address + ':' + remote.port)
      logger.debug(message.toString('hex'))
      if(message.length < 4){
        logger.debug('tracker Response is less than 4 bytes. Aborting.')
        return 
      }
      const action = message.readUInt32BE(0)
      logger.verbose('Action : '+action)
      switch(action){
        case CONNECT_ACTION :
          parseConnectResponse(message).cata(
            (err: Error) => { 
              logger.error(err.message)
              reject(err)
            },
            ({connectionId, transactionId}) => this.sendUDPAnnounceRequest(connectionId, transactionId, event)
          )
          break
        case ANNOUNCE_ACTION :
          parseAnnounceResponse(this.transactionID)(message).cata(
            (err: Error) => {
              logger.error(err.message)
              reject(err)
            },
            (success: TrackerResponse) => resolve(success)
          )
        break 
        case SCRAPE_ACTION :
        break 
        case ERROR_ACTION :
          logger.error(`ERROR : ${message.toString()}`)
          reject(new Error(message.toString()))
          break 
        default :
          break 
      }
    })
    
    logger.info(`Connecting to ${this.trackerURL}`)
    const connectMessage: Buffer = buildConnectRequest(this.transactionID)
    logger.debug('Sending Connect Message')
    logger.debug(connectMessage.toString('hex'))
    if(this.trackerURL && this.trackerPort){
      this.server.send(connectMessage, 0, 16, parseInt(this.trackerPort), this.trackerURL, function(error){
        if(error){
          reject(error)
        }
      })
    } else {
      logger.warn('Unable to parse tracker IP and Address')
      reject(new Error('Unable to parse tracker IP and Address'))

    }
    })  
  }
  
  private sendUDPAnnounceRequest(connectionId: Buffer, transactionId: Buffer, torrentEvent: string){
    const requestMessage: Buffer = buildAnnounceRequest(connectionId, transactionId, this.torrent)(torrentEvent)
    if(this.trackerURL && this.trackerPort){
      this.server.send(requestMessage, 0, 98, parseInt(this.trackerPort), this.trackerURL, function(error){
        if(error)
        logger.error(error.message)
      })
    } else {
      logger.warn('Unable to parse tracker IP and Address')
    }
  }
}
const parseAnnounceResponse = (transactionId: Buffer) => (message: Buffer): Either<Error, TrackerResponse> => {
    let messageError: string
    /* Offset      Size            Name            Value
    0           32-bit integer  action          1 // announce
    4           32-bit integer  transaction_id
    8           32-bit integer  interval
    12          32-bit integer  leechers
    16          32-bit integer  seeders
    20 + 6 * n  32-bit integer  IP address
    24 + 6 * n  16-bit integer  TCP port
    20 + 6 * N */
    if(message.length < 20){
      messageError = 'Error : Request Message should be 20 bytes length'
      logger.error(messageError)
      return Left(new Error(messageError))
    }
    
    /*const transactionID = message.slice(4, 8)
    if(transactionID.equals(transactionId)){
      messageError = 'Error : TransactionID does not match the one sent by the client'
      logger.error(messageError)
      return Left(new Error(messageError))
    }*/
    
    const interval = message.readUInt32BE(8)
    const leechers = message.readUInt32BE(12)
    const seeders = message.readUInt32BE(16)
    logger.info(`Seeders : ${seeders} Leechers : ${leechers}`)
    
    const peersPart = message.slice(20)
    const peers: string[] = compact2string.multi(peersPart)
    const result: TrackerResponse = {
      interval,
      seeders,
      leechers,
      peers
    }
    return Right(result)
  } 

const parseConnectResponse = (message: Buffer): Either<Error, {connectionId: Buffer, transactionId: Buffer}> => {
  if(message.length < 16){
    logger.error('Error : Connect Message should be 16 bytes length')
    return Left( new Error('Error : Connect Message should be 16 bytes length'))
  }
  const transactionId = message.slice(0, 4)
  logger.debug('TransactionID : '+ transactionId.toString('hex'))
  /*if(transactionId != this.transactionID.readUInt32BE(0)){
    logger.error('Error : TransactionID does not match the one sent by the client')
    return Left(new Error('Error : TransactionID does not match the one sent by the client'))
  }*/
  
  const connectionId: Buffer = message.slice(8)
  logger.debug('Connection ID : '+connectionId.toString('hex'))
  return Right({connectionId, transactionId})
}
const buildConnectRequest = (transactionID: Buffer): Buffer => {
  const connectActionBuffer: Buffer = Buffer.alloc(4)
  connectActionBuffer.writeUInt32BE(CONNECT_ACTION, 0)
  const connectMessage = Buffer.concat([protocolIDBuffer, connectActionBuffer, transactionID])
  return connectMessage
}
const buildAnnounceRequest = (connectionID: Buffer, transactionID: Buffer, torrent: Torrent) => (event: string): Buffer => {
  /*  Offset  Size    Name    Value
  0       64-bit integer  connection_id
  8       32-bit integer  action          1 // announce
  12      32-bit integer  transaction_id
  16      20-byte string  info_hash
  36      20-byte string  peer_id
  56      64-bit integer  downloaded
  64      64-bit integer  left
  72      64-bit integer  uploaded
  80      32-bit integer  event           0 // 0: none 1: completed 2: started 3: stopped
  84      32-bit integer  IP address      0 // default
  88      32-bit integer  key
  92      32-bit integer  num_want        -1 // default
  96      16-bit integer  port
  98*/
  const requestMessage = Buffer.alloc(98)
  logger.debug('Connection ID : '+connectionID.toString('hex'))
  connectionID.copy(requestMessage, 0)
  requestMessage.writeUInt32BE(ANNOUNCE_ACTION, 8)
  transactionID.copy(requestMessage, 12)
  torrent.infoHash.copy(requestMessage, 16)
  crypto.randomBytes(20).copy(requestMessage, 36) 
  const amountDownloadedBuffer = writeInt64BE(torrent.downloaded)
  amountDownloadedBuffer.copy(requestMessage, 56)
  const amountLeftBuffer = writeInt64BE(torrent.size - torrent.completed)
  amountLeftBuffer.copy(requestMessage, 64)
  const amountUploadedBuffer = writeInt64BE(torrent.completed)
  amountUploadedBuffer.copy(requestMessage, 72)
  requestMessage.writeUInt32BE(EVENTS[event], 80)
  requestMessage.writeUInt32BE(0, 84)
  requestMessage.writeInt32BE(123456, 88)
  requestMessage.writeInt32BE(-1, 92)
  requestMessage.writeUInt16BE(torrent.port, 96)
  logger.debug('Request Message : ' +requestMessage.toString('hex'))
  return requestMessage
}

const writeInt64BE = (value: number): Buffer => {
  const hexString = value.toString(16)
  const hexStringPadded = hexString.length % 2 == 1 ? '0'+ hexString : hexString
  const buf = Buffer.alloc(8)
  const lowBytes = `0x${hexStringPadded.slice(-8)}`
  buf.writeUInt32BE(parseInt(lowBytes, 16), 4)
  if (hexStringPadded.length > 8){
    const highBytes = `0x${hexStringPadded.slice(-16, -8)}`
    buf.writeUInt32BE(parseInt(highBytes, 16), 0)
  }
  return buf
}

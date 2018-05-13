import * as dgram from 'dgram'
import * as crypto from 'crypto'
import { logger } from '../logging/logger'
import * as Utils from '../utils/utils'
import * as util from 'util'
import * as url from 'url'
import Tracker from './tracker'

const compact2string = require("compact2string");

const DEFAULT_CONNECTION_ID = 0x41727101980;
const CONNECT_ACTION = 0;
const ANNOUNCE_ACTION = 1;
const SCRAPE_ACTION = 2;
const ERROR_ACTION = 3;

export class UDPTracker extends Tracker {
  transactionID: Buffer
  connectionID: number
  server: dgram.Socket


  constructor(announceURL: string, torrent){
    super(announceURL, torrent)
    this.transactionID = crypto.randomBytes(4)
    const urlObject: url.UrlWithStringQuery = url.parse(announceURL)
    this.trackerURL = (urlObject.hostname == "0.0.0.0" ? "127.0.0.1" : urlObject.hostname);
    this.trackerPort = urlObject.port;
    logger.verbose(`Tracker Infos : ${this.trackerURL}:${this.trackerPort}`);

    const server = dgram.createSocket("udp4");
    const self = this;

    server.on('message', function (message, remote) {
        callbackTrackerResponseUDP.call(self, message, remote)
    });

    server.on('listening', () => {
        const address = server.address();
        logger.verbose(`Server listening ${address.address}:${address.port}`);
        self.announce();
    });

    this.server = server;
    server.bind()
  }

  announce(){
    let self = this;
    logger.info(`Connecting to ${self.trackerURL}`);
    let connectMessage = Buffer.alloc(12);
    const connectionIDBuffer = Buffer.from(Utils.decimalToHexString(DEFAULT_CONNECTION_ID), "hex");
    connectionIDBuffer.copy(connectMessage, 0+8-connectionIDBuffer.length);
    connectMessage.writeInt32BE(CONNECT_ACTION, 8);
    connectMessage = Buffer.concat([connectMessage, this.transactionID]);
    logger.debug("Sending Connect Message");
    logger.debug(connectMessage.toString());
    if(this.trackerURL && this.trackerPort){
      this.server.send(connectMessage, 0, 16, parseInt(this.trackerPort), this.trackerURL, function(error){
        if(error)
        logger.error(error.message)
      })
    } else {
      logger.warn("Unable to parse tracker IP and Address")
    }
  }

  private makeUDPAnnounceRequest(torrentEvent: string){
    /*  Offset  Size    Name    Value
   0       64-bit integer  connection_id
   8       32-bit integer  action          1 // announce
   12      32-bit integer  transaction_id
   16      20-byte string  info_hash
   36      20-byte string  peer_id
   56      64-bit integer  downloaded
   64      64-bit integer  left
   72      64-bit integer  uploaded
   80      32-bit integer  event           0 // 0: none; 1: completed; 2: started; 3: stopped
   84      32-bit integer  IP address      0 // default
   88      32-bit integer  key
   92      32-bit integer  num_want        -1 // default
   96      16-bit integer  port
   98*/
       const requestMessage = Buffer.alloc(98);
       logger.debug("Connection ID : "+this.connectionID);
       const connectionIDBuffer = Buffer.from(Utils.decimalToHexString(DEFAULT_CONNECTION_ID), "hex");
       connectionIDBuffer.copy(requestMessage, 0 + 8 - connectionIDBuffer.length);
       requestMessage.writeInt32BE(ANNOUNCE_ACTION, 8);
       requestMessage.writeInt32BE(this.transactionID.readInt32BE(0), 12);
   
       const infoHash: Buffer = this.torrent.infoHash
       requestMessage.write(infoHash.toString(), 16, 20);
       requestMessage.write("CLI Torrent Client", 36, 20);
       const amountDownloadedBuffer = Buffer.from(Utils.decimalToHexString(this.torrent.downloaded), "hex");
       amountDownloadedBuffer.copy(requestMessage, 56 + 8 - amountDownloadedBuffer.length);
       const amountLeftBuffer = Buffer.from(Utils.decimalToHexString(this.torrent.left), "hex");
       amountLeftBuffer.copy(requestMessage, 64 + 8 - amountLeftBuffer.length);
       const amountUploadedBuffer = Buffer.from(Utils.decimalToHexString(this.torrent.uploaded), "hex");
       amountUploadedBuffer.copy(requestMessage, 72 + 8 - amountUploadedBuffer.length);
       //requestMessage.writeInt32BE(torrentEvent, 80);
       requestMessage.writeUInt32BE(0, 84);
       requestMessage.writeInt32BE(123456, 88);
       requestMessage.writeInt32BE(-1, 92);
       requestMessage.writeInt16BE(this.torrent.port, 96);
   
       logger.silly(requestMessage.toString());
   
       if(this.trackerURL && this.trackerPort){
         this.server.send(requestMessage, 0, 98, parseInt(this.trackerPort), this.trackerURL, function(error){
           if(error)
           logger.error(error.message)
         })
       } else {
         logger.warn("Unable to parse tracker IP and Address")
       }
   };

  private onConnectResponse(message: Buffer){
    if(message.length < 16){
        logger.error("Error : Connect Message should be 16 bytes length");
      throw "Error : Connect Message should be 16 bytes length"
    }
      const transactionID = message.readInt32BE(4);
      logger.debug("TransactionID : "+ transactionID);
      if(transactionID != this.transactionID.readInt32BE(0)){
        logger.error("Error : TransactionID does not match the one sent by the client");
      throw "Error : TransactionID does not match the one sent by the client"
    }
  
   this.connectionID = message.readIntBE(8, 8);
   logger.debug("Connection ID : "+this.connectionID);
   this.makeUDPAnnounceRequest('');
  };

  private onAnnounceResponse(message: Buffer){
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
      throw "Error : Request Message should be 20 bytes length"
    }
  
      const transactionID = message.readInt32BE(4);
      if(transactionID != this.transactionID.readInt32BE(0)){
        logger.error("Error : TransactionID does not match the one sent by the client");
      throw "Error : TransactionID does not match the one sent by the client"
    }
  
    this.intervalInSeconds = message.readInt32BE(8);
      const leechers = message.readInt32BE(12);
      const seeders = message.readInt32BE(16);
      logger.info(`Seeders : ${seeders} Leechers : ${leechers}`);
  
      const peersPart = message.slice(20);
      const peerList = compact2string.multi(peersPart);
      logger.verbose("peers : "+peerList);
      this.emit("peers", peerList)
  }; 
}
const callbackTrackerResponseUDP = function(message: Buffer, remote: dgram.AddressInfo){
  logger.debug("Message received from : "+remote.address + ':' + remote.port);
  logger.debug(message.toString());
  if(message.length < 4){
    logger.debug("tracker Response is less than 4 bytes. Aborting.");
    return ;
  }

    const action = message.readInt32BE(0);
    logger.verbose("Action : "+action);
  switch(action){
    case CONNECT_ACTION :
      this.onConnectResponse(message) ;
      break ;
    case ANNOUNCE_ACTION :
      this.onAnnounceResponse(message);
      break ;
    case SCRAPE_ACTION :
      break ;
    case ERROR_ACTION :
      logger.error(`ERROR : ${message}`);
      break ;
    default :
      break ;
  }
};

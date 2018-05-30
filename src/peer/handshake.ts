import { logger } from '../logging/logger'

const MIN_HANDSHAKE_LENGTH = 48;
const MAX_HANDHSAKE_LENGTH = 68;
const INFO_HASH_LENGTH = 20;
const PEER_ID_LENGTH = 20;
const PROTOCOL_LENGTH = 19;
const PROTOCOL_NAME = "BitTorrent protocol";
const protocolName: Buffer = Buffer.from(PROTOCOL_NAME, 'utf8')
const reservedBytes: Buffer = Buffer.alloc(8)

const ensureHandshakeLength = (chunk: Buffer): Promise<Buffer> => {
  const handshakeLength = chunk.length
  return new Promise(function(resolve, reject){
    if(handshakeLength == MIN_HANDSHAKE_LENGTH || handshakeLength == MAX_HANDHSAKE_LENGTH){
      resolve(chunk)
    } else {
      const message = `Invalid Handshake length (${chunk.length})`
      logger.error(message)
      reject(message)
    }
  })
}

const ensureRightProtocol = (chunk: Buffer): Promise<Buffer> => {
  const protocolLength: number = chunk[0];
  const protocol: Buffer = chunk.slice(1, protocolLength+1);
  return new Promise(function(resolve, reject){
    if(protocolLength == PROTOCOL_LENGTH && protocol.equals(protocolName)){
      resolve(chunk)
    } else {
      const message = `Invalid Protocol Length (${protocolLength}) and Protocol Name ${protocol.toString("utf8")}`
      logger.warn("Handshake Parser :"+message)
      reject(message)
    }
  })
}

const getInfoHash = (chunk: Buffer): Promise<{chunk: Buffer, infoHash: Buffer}> => {
  const infoHash: Buffer = chunk.slice(28, 28+INFO_HASH_LENGTH);
  return new Promise((resolve, reject) => {
    resolve({chunk, infoHash})
  })
}

const getPeerId = ({chunk, infoHash}): Promise<{peerId?: Buffer, infoHash: Buffer}> => {
  const handshakeLength: number = chunk.length
  return new Promise(function(resolve, reject){
    if (handshakeLength == MIN_HANDSHAKE_LENGTH){
      resolve({infoHash : infoHash});
    } else if (handshakeLength == MAX_HANDHSAKE_LENGTH){
      const peerId: Buffer = chunk.slice(48);
      resolve({infoHash, peerId});
    }
  });
}


export const parse = (chunk: Buffer): Promise<{peerId?: Buffer, infoHash: Buffer}> => {
  return ensureHandshakeLength(chunk)
  .then(ensureRightProtocol)
  .then(getInfoHash)
  .then(getPeerId)
}


export const build = (infoHash: Buffer, peerId: Buffer): Buffer => {
  const protocolLengthBuffer = Buffer.alloc(1)
  protocolLengthBuffer[0] = 19
  return Buffer.concat([protocolLengthBuffer, protocolName, reservedBytes, infoHash, peerId], MAX_HANDHSAKE_LENGTH);
};

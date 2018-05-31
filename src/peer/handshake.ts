import { logger } from '../logging/logger'
import { Either, Left, Right } from 'monet'

export const HANDHSAKE_LENGTH = 68;
const INFO_HASH_LENGTH = 20;
const PEER_ID_LENGTH = 20;
const PROTOCOL_LENGTH = 19;
const PROTOCOL_NAME = "BitTorrent protocol";
const protocolName: Buffer = Buffer.from(PROTOCOL_NAME, 'utf8')
const reservedBytes: Buffer = Buffer.alloc(8)

const ensureHandshakeLength = (chunk: Buffer): Either<Error, Buffer> => {
  if(chunk.length >= HANDHSAKE_LENGTH){
    return Right(chunk)
  } else {
    const message = `Invalid Handshake length (${chunk.length})`
    return Left(new Error(message))
    
  }
}

const ensureRightProtocol = (chunk: Buffer): Either<Error, Buffer> => {
  const protocolLength: number = chunk[0];
  const protocol: Buffer = chunk.slice(1, protocolLength+1);
  if(protocolLength == PROTOCOL_LENGTH && protocol.equals(protocolName)){
    return Right(chunk)
  } else {
    const message = `Invalid Protocol Length (${protocolLength}) and Protocol Name ${protocol.toString("utf8")}`
    logger.warn("Handshake Parser :"+message)
    return Left(new Error(message))
  }
}

const getInfoHash = (chunk: Buffer): Either<Error, {chunk: Buffer, infoHash: Buffer}> => {
  const infoHash: Buffer = chunk.slice(28, 28 + INFO_HASH_LENGTH);
  return Right({chunk, infoHash})
}

const getPeerId = (chunkWithInfoHash: {chunk: Buffer, infoHash: Buffer}): Either<Error, {peerId: Buffer, infoHash: Buffer}> => {
  const { chunk, infoHash } = chunkWithInfoHash
  const peerId: Buffer = chunk.slice(48, 48 + PEER_ID_LENGTH);
    return Right({infoHash, peerId});
}

export const parse = (chunk: Buffer): Either<Error, {peerId?: Buffer, infoHash: Buffer}> => {
  return ensureHandshakeLength(chunk)
  .chain(ensureRightProtocol)
  .chain(getInfoHash)
  .chain(getPeerId)
}


export const build = (infoHash: Buffer, peerId: Buffer): Buffer => {
  const protocolLengthBuffer = Buffer.alloc(1)
  protocolLengthBuffer[0] = 19
  return Buffer.concat([protocolLengthBuffer, protocolName, reservedBytes, infoHash, peerId], HANDHSAKE_LENGTH);
};

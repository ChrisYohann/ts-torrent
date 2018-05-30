import { TorrentDict } from './types'
import { EventEmitter } from 'events'
import TorrentDisk from '../disk/torrentDisk'
import { Tracker, TrackerResponse } from '../tracker/tracker'
import { HTTPTracker } from '../tracker/httpTracker'
import { UDPTracker } from '../tracker/udpTracker'
import * as PeerManager from '../peer/peerManager'
import { Peer } from '../peer/peer'
import * as BencodeUtils from '../bencode/utils'
import { logger } from '../logging/logger'
import * as Utils from '../utils/utils'
import * as R from 'ramda'
import * as events from '../events/events'
import * as net from 'net'
import * as Handshake from '../peer/handshake'
import { Maybe } from 'monet'
import * as path from 'path'
import * as _ from 'underscore'
import { createHash, Hash, randomBytes } from 'crypto'

const udpAddressRegex = /^(udp:\/\/[\w.-]+):(\d{2,})[^\s]*$/g;
const httpAddressRegex = /^(http:\/\/[\w.-]+):(\d{2,})[^\s]*$/g;
const MAX_ACTIVE_PEERS = 1 ;

export class Torrent extends EventEmitter {
    metadata: TorrentDict
    name: string
    filepath: string

    infoHash: Buffer

    disk: TorrentDisk
    bitfield: Buffer
    nbPieces: number
    pieceLength: number

    uploaded: number = 0
    downloaded: number = 0
    completed: number
    size: number
    bitrate: number

    port: number
    lastKnownPeers: string[]
    activePeers: Peer[] = []
    actualTrackerIndex: number = 1
    activeTracker: Tracker
    trackers: string[]
    
    askedPieces: number[]
    pieceRequestGenerator: IterableIterator<{peer: Peer, pieceIndex: number}[]>

    constructor(meta: TorrentDict, filepath: string){
        super()

        const sha1Hash: Hash = createHash('sha1')

        this.metadata = meta
        this.name = meta.info.name
        this.filepath = filepath
        this.trackers = getTrackersFromTorrentDict(meta)
        this.infoHash = sha1Hash.update(BencodeUtils.encode(meta.info)).digest()
        this.disk = new TorrentDisk(meta, path.dirname(filepath))
        this.pieceRequestGenerator = PeerManager.askPeersForPieces(this)()
    }

    async init(){
        //this.initTracker()
        await this.disk.init()
            .then((status) => this.disk.getBitfield())
            .then(({bitfield, completed}) => {
                this.completed = completed
                this.bitfield = bitfield
            })
    }

    async start(){
        if(this.trackers.length <= 0){
            logger.error("No valid tracker found. Aborting.");
        } else {
            const maybeTracker: Maybe<Tracker> = this.getHTTPorUDPTracker(this.trackers[this.actualTrackerIndex])
            if (maybeTracker.isSome()){
                this.activeTracker = maybeTracker.some()
                try {
                    const response: TrackerResponse = await this.activeTracker.announce("started")
                if(!this.isCompleted()){
                    const { peers } = response
                    logger.verbose(`Peers : ${R.take(5, peers)}`)
                    const newPeers: Peer[] = await this.lookForNewPeers(peers)
                    this.addPeersAndLookForPieces(newPeers)
                } 
                    this.on(events.HAVE, (index: number) => {
                        this.askedPieces = R.remove(
                            R.indexOf(index)(this.askedPieces),
                            1,
                            this.askedPieces)
                    this.lookForNewPieces()
                })
                } catch (err){

                }   
            } else {
                //No tracker
            } 
        }
    }

    stop(callback){
        logger.info(`Invoking Stop for ${this.name} torrent.`)
        let message = `${this.name} Torrent Successfully stopped.`
        callback(message)
    }

    addPeersAndLookForPieces(peers: Peer[]): void {
        this.activePeers = R.concat(this.activePeers, peers)
        this.lookForNewPieces()
    }

    addPeer(peer: Peer): void {
        this.activePeers = R.append(peer, this.activePeers)
        peer.start()
        this.lookForNewPieces()
    }

    async lookForNewPeers(peerList: string[]): Promise<Peer[]> {
        const nbPeersToAdd: number = MAX_ACTIVE_PEERS - this.activePeers.length
        const unknownPeers: string[] = R.filter((newPeerAddress: string) => {
            return R.all((activePeer: Peer) => activePeer.remoteAddress !== newPeerAddress, this.activePeers)
        }, peerList)
        const unknownPeersTruncated: string[] = R.take(nbPeersToAdd, unknownPeers)

        const maybePeers: Maybe<Peer>[] = await Promise.all(R.map(async (unknownPeerAddress: string) => {
            const [host, port] = unknownPeerAddress.split(':')
            const peer: Maybe<Peer> = await getPeer(this, host, port)
            return peer
        })(unknownPeersTruncated))

        const newPeers: Peer[] = (() => {
            const somePeers = R.filter<Maybe<Peer>>((maybePeer: Maybe<Peer>) => maybePeer.isSome())(maybePeers)
            const peers: Peer[] = R.map((maybePeer: Maybe<Peer>) => maybePeer.some())(maybePeers)
            logger.debug(`new Peers : ${peers.length}`)
            R.forEach((peer: Peer) => {
                peer.on('unchoked', () => {
                    logger.verbose('Peer Unchoked')
                    this.lookForNewPieces()
                })
                peer.start()
            }, peers)
            return peers
        })()
        
        return newPeers
    }

    lookForNewPieces(): void {
        const {value, done} = this.pieceRequestGenerator.next()
        if (!done){
            R.forEach(({peer, pieceIndex}: {peer: Peer, pieceIndex: number}) => {
                peer.sendRequest(pieceIndex)
            })(value)
        }
    }

    getHTTPorUDPTracker(trackerURL: string): Maybe<Tracker> {
        let self = this;
        if(trackerURL.match(httpAddressRegex)){
            return Maybe.of(new HTTPTracker(trackerURL, this))
        } else if(trackerURL.match(udpAddressRegex)){
            return Maybe.of(new UDPTracker(trackerURL, this))
        } else {
            logger.error(`No valid Protocol for ${trackerURL} found. Aborting.`);
            return Maybe.None()
        }
    }

    containsPiece(index: number): boolean {
        return Utils.bitfieldContainsPiece(this.bitfield, index);
    }

    isCompleted(): boolean {
        return (this.size -  this.completed) === 0
    }

    getLastPieceLength(){
        return this.disk.infoDictionary.computeLastPieceLength()
    }

    read(index: number, begin: number, length: number): Promise<Buffer>{
        return this.disk.read(index, begin, length)
    }

    async write(index: number, begin: number, block: Buffer){
        const {bytesWritten, isPieceCompletedAndValid} = await this.disk.write(index, begin, block)
        this.completed += bytesWritten
        if(isPieceCompletedAndValid){
            this.emit(events.HAVE, index)
        }
        return isPieceCompletedAndValid
    }
}

const getPeer = (torrent: Torrent, host: string, port: string): Promise<Maybe<Peer>> => {
    return new Promise((resolve, reject) => {
        logger.verbose(`Connecting to ${host} at port ${port} for ${torrent.name}`)
        const timer = setTimeout(() => {
            logger.verbose(`${socket.remoteAddress} : Timeout of 10 seconds exceeded. Aborting Connection.`)
            //socket.destroy()
            resolve(Maybe.None())
        }, 10000)
        const socket: net.Socket = net.createConnection({
            host,
            port: parseInt(port)
        }, 
        () => {
            logger.verbose(`Connected to ${socket.remoteAddress}`)
            socket.on('error', (err: Error) => {
                logger.error(err.message)
                resolve(Maybe.None())
            })
            socket.once('data', (chunk: Buffer) => {
                logger.verbose(`Received ${chunk.length} bytes from ${socket.remoteAddress} : ${chunk.toString('hex')}`)
                Handshake.parse(chunk).then(({peerId, infoHash}) => {
                  logger.verbose('Handshake parsed without errors')
                  if (!infoHash.equals(torrent.infoHash)){
                    logger.verbose("Peer Id Hash and Torrent Hash does not match. Aborting")
                    socket.end()
                    resolve(Maybe.None())
                    
                  } else {
                      logger.verbose(`Connection succeded to ${socket.remoteAddress} for Torrent : ${torrent.name}`)
                      resolve(Maybe.Some(new Peer(torrent, socket, peerId)))
                  }
                }).catch((failure) => {
                  logger.error("Error in Parsing Handshake. Aborting Connection")
                  socket.end()
                  resolve(Maybe.None())
                }).then(() => {
                    clearTimeout(timer)
                })
              })
            const handshake: Buffer = Handshake.build(torrent.infoHash, randomBytes(20))
            logger.verbose(`Handshake Length : ${handshake.length}`)
            logger.verbose(`Handshake : ${handshake.toString('hex')}`)
            socket.write(handshake, 'utf8', () => {
            logger.verbose(`Handshake sent to ${socket.remoteAddress}`)
            })
        })    
    }) 
}

export const getTrackersFromTorrentDict = (meta: TorrentDict): string[] => {
    return meta['announce-list'] ? _.flatten(meta['announce-list']) : [meta.announce]
}


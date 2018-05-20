import { TorrentDict } from './types'
import { EventEmitter } from 'events'
import TorrentDisk from '../disk/torrentDisk'
import Tracker from '../tracker/tracker'
import { HTTPTracker } from '../tracker/httpTracker'
import { UDPTracker } from '../tracker/udpTracker'
import * as PeerManager from '../peer/peerManager'
import Peer from '../peer/peer'
import * as BencodeUtils from '../bencode/utils'
import { logger } from '../logging/logger'
import * as Utils from '../utils/utils'
import * as R from 'ramda'
import * as events from '../events/events'
import * as net from 'net'
import * as Handshake from '../peer/handshake'
import { Maybe } from 'monet'

const udpAddressRegex = /^(udp:\/\/[\w.-]+):(\d{2,})[^\s]*$/g;
const httpAddressRegex = /^(http:\/\/[\w.-]+):(\d{2,})[^\s]*$/g;
const MAX_ACTIVE_PEERS = 5 ;

export default class Torrent extends EventEmitter {
    metadata: TorrentDict
    name: string
    mainTrackerURL: string
    otherTrackersURLs: string[][]
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
    actualTrackerIndex: number
    activeTracker: Tracker
    trackers: string[]
    
    askedPieces: number[]
    pieceRequestGenerator: IterableIterator<{peer: Peer, pieceIndex: number}[]>

    constructor(meta: TorrentDict, filepath: string){
        super()
        this.metadata = meta
        this.name = meta.info.name
        this.mainTrackerURL = meta.announce
        this.otherTrackersURLs = meta["announce-list"]
        this.infoHash = BencodeUtils.encode(meta.info)
        this.disk = new TorrentDisk(meta, filepath)
        this.pieceRequestGenerator = PeerManager.askPeersForPieces(this)()
    }

    start(){
        if(this.trackers.length <= 0){
            logger.error("No valid tracker found. Aborting.");
        } else {
            this.activeTracker = this.getHTTPorUDPTracker(this.trackers[this.actualTrackerIndex]);
            this.activeTracker.on("peers", async (peerList: string[]) => {
                if(!this.isCompleted()){
                    const newPeers: Peer[] = await this.lookForNewPeers(peerList)
                    this.addPeersAndLookForPieces(newPeers)
                }   
            })
            this.activeTracker.announce("started")
            this.on(events.HAVE, (index: number) => {
                this.askedPieces = R.pipe(
                    R.indexOf(index),
                    R.remove()
                )(this.askedPieces)
                this.lookForNewPieces()
            })
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
        this.activePeers = R.append(this.activePeers, peer)
        this.lookForNewPieces()
    }

    async lookForNewPeers(peerList: string): Peer[]{
        let self = this
        const nbPeersToAdd: number = MAX_ACTIVE_PEERS - this.activePeers.length
        const unknownPeers: string[] = R.pipe(
            R.filter((newPeerAddress: string) => R.filter((activePeer: Peer) => activePeer.remoteAddress !== newPeerAddress)(this.activePeers)),
            R.take(nbPeersToAdd)
        )(peerList)

        const maybePeers: Maybe<Peer>[] = await Promise.all(R.map(async (unknownPeerAddress: string) => {
            const [host, port]: [string, string] = unknownPeerAddress.split(':')
            const peer: Maybe<Peer> = await getPeer(this, host, parseInt(port))
            return peer
        })(unknownPeers))

        const newPeers: Peer[] = R.pipe(
            R.filter((maybePeer: Maybe<Peer>) => maybePeer.isSome(), maybePeers),
            R.map((maybePeer: Maybe<Peer>) => maybePeer.some()),
            R.forEach((peer: Peer) => peer.start())
        )(maybePeers)
        
        return newPeers
    }

    lookForNewPieces(): void {
        const {value, done} = this.pieceRequestGenerator.next()
        if (!done){
            R.forEach(({peer, pieceIndex}: {peer: Peer, pieceIndex: number}) => {
                peer.requestPiece(pieceIndex)
            })(value)
        }
    }

    getHTTPorUDPTracker(trackerURL: string) {
        let self = this;
        if(trackerURL.match(httpAddressRegex)){
            return new HTTPTracker(trackerURL, this)
        } else if(trackerURL.match(udpAddressRegex)){
            return new UDPTracker(trackerURL, this)
        } else {
            logger.error("No valid Protocol for ${trackerURL} found. Aborting.");
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
            self.emit(events.HAVE, pieceIndex)
        }
        return isPieceCompletedAndValid
    }
}

const getPeer = (torrent: Torrent, host: string, port: string): Promise<Maybe<Peer>> => {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            resolve(Maybe.None())
        }, 10000)
        const socket: net.Socket = net.createConnection({
            host,
            port: parseInt(port)
        }, 
        () => {
            socket.once('data', (chunk: Buffer) => {
                Handshake.parse(chunk).then(({peerId, infoHash}) => {
                  if (!infoHash.equals(torrent.infoHash)){
                    logger.verbose("Peer Id Hash and Torrent Hash does not match. Aborting")
                    socket.end()
                    resolve(Maybe.None())
                    
                  } else {
                      logger.verbose(`Connecting to ${socket.remoteAddress} for Torrent : ${torrent.name}`)
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
            const handshake: Buffer = Handshake.build(torrent.infoHash, null)
            socket.write(handshake, 'utf8', () => {
            logger.verbose(`Handshake sent to ${socket.remoteAddress}`)
            })
        }    
    }  
})
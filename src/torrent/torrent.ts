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
import { CONNECTION_SUCCESSFUL, INVALID_PEER } from '../events/events'

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
    lastKnownPeers: {host: string; port: number}[]
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
        this.askedPieces = []
    }

    async init(){
        await this.disk.init()
            .then((status) => this.disk.getBitfield())
            .then(({bitfield, completed}) => {
                this.completed = completed
                this.bitfield = bitfield
                this.nbPieces = this.disk.infoDictionary.nbPieces
            })
    }

    async start(){
        if(this.trackers.length <= 0){
            logger.error('No valid tracker found. Aborting.');
        } else {
            const maybeTracker: Maybe<Tracker> = this.getHTTPorUDPTracker(this.trackers[this.actualTrackerIndex])
            if (maybeTracker.isSome()){
                this.activeTracker = maybeTracker.some()
                try {
                    const response: TrackerResponse = await this.activeTracker.announce('started')
                if(!this.isCompleted()){
                    const { peers } = response
                    this.lastKnownPeers = R.map((peerAddress: string) => {
                        const [host, portAsString]: [string, string] = peerAddress.split(':') as [string, string]
                        const port: number = parseInt(portAsString)
                        return { host, port }
                    })(_.shuffle(peers))
                    
                    logger.verbose(`First 5 Peers : ${JSON.stringify(R.take(5, this.lastKnownPeers))}`)
                    this.connectToNewPeers()
                } 
                    this.on(events.HAVE, (index: number) => {
                        this.askedPieces = R.remove(
                            R.indexOf(index)(this.askedPieces),
                            1,
                            this.askedPieces)
                    this.lookForNewPieces()
                })
                } catch (err){
                    logger.error('Error while attempting to send a request to the tracker. Trying next on the list.')
                    logger.error(err.message)
                    this.actualTrackerIndex += 1
                    //this.start()
                }   
            } else {
                logger.error('Error while parsing Tracker address. Trying next on the list')
                this.actualTrackerIndex += 1
                this.start()
            } 
        }
    }

    stop(callback){
        logger.info(`Invoking Stop for ${this.name} torrent.`)
        let message = `${this.name} Torrent Successfully stopped.`
        callback(message)
    }

    connectToNewPeers(): void {
        logger.verbose('Connecting to new Peers')
        const nbPeersToAdd: number = MAX_ACTIVE_PEERS - this.activePeers.length

        const notAlreadyConnectedPeers: {host: string; port: number}[] = R.filter(({host, port}) => {
            return R.all((activePeer: Peer) => activePeer.remoteAddress !== host, this.activePeers)
        }, this.lastKnownPeers)

        logger.verbose(`Peer List length = ${this.lastKnownPeers.length}. Unknown Peers : ${notAlreadyConnectedPeers.length}`)

        const newPeersToConnect: {host: string; port: number}[] = R.take(nbPeersToAdd, notAlreadyConnectedPeers)
        this.lastKnownPeers = R.slice(nbPeersToAdd, Infinity, notAlreadyConnectedPeers)
        R.forEach(({host, port}) => {
            this.getPeer(this, host, port)
        })(newPeersToConnect)
        
    }

    getPeer(torrent: Torrent, host: string, port: number): void {
        const peer: Peer = new Peer(torrent, {host, port})
        
        peer.on(CONNECTION_SUCCESSFUL, () => {
            logger.verbose(`Successfully connected to ${host} for torrent ${torrent.name}`)
            this.activePeers = R.append(peer, this.activePeers)
            peer.start()
            this.lookForNewPieces()
        })
        peer.on(INVALID_PEER, () => {
            logger.verbose(`Error while creating connection with ${host}. Aborting.`)
            this.activePeers = R.filter((otherPeer: Peer) => otherPeer !== peer, this.activePeers)
            this.connectToNewPeers()
        })
    }

    lookForNewPieces(): void {
        const {value, done} = this.pieceRequestGenerator.next()
        logger.verbose(`${{value, done}}`)
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
 
export const getTrackersFromTorrentDict = (meta: TorrentDict): string[] => {
    return meta['announce-list'] ? _.flatten(meta['announce-list']) : [meta.announce]
}


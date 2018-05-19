import { TorrentDict } from './types'
import { EventEmitter } from 'events'
import TorrentDisk from '../disk/torrentDisk'
import Tracker from '../tracker/tracker'
import { HTTPTracker } from '../tracker/httpTracker'
import { UDPTracker } from '../tracker/udpTracker'
import PeerManager from '../peer/peerManager'
import Peer from '../peer/peer'
import * as BencodeUtils from '../bencode/utils'
import { logger } from '../logging/logger'
import * as Utils from '../utils/utils'

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
    activePeers: Peer[]
    actualTrackerIndex: number
    activeTracker: Tracker
    trackers: string[]

    constructor(meta: TorrentDict, filepath: string){
        super()
        this.metadata = meta
        this.name = meta.info.name
        this.mainTrackerURL = meta.announce
        this.otherTrackersURLs = meta["announce-list"]
        this.infoHash = BencodeUtils.encode(meta.info)

        this.disk = new TorrentDisk(meta, filepath)
        this.trackers = (function(){
            if(this.trackerList){
                let mergedTrackers = [].concat.apply([], self["trackerList"]);
                return mergedTrackers ;
            } else {
                return Array(self["_mainTracker"]);
            }
        })();
    }

    start(){
        let self = this
        if(this.trackers.length <= 0){
            logger.error("No valid tracker found. Aborting.");
        } else {
            this.activeTracker = this.getHTTPorUDPTracker(this.trackers[this.actualTrackerIndex]);
            this.activeTracker.on("peers", (peerList: string[]) => {
                peerList.forEach((peer: string) => {
                  self.lastKnownPeers.push(peer)
                });
                if(this.size - this.completed > 0){
                    this.seekForPeers();
                }
            });
            self.activeTracker.announce("started");
        }
    }

    stop(callback) {
        logger.info(`Invoking Stop for ${this.name} torrent.`)
        let message = `${this.name} Torrent Successfully stopped.`
        callback(message)
    }

    seekForPeers(){
        let nbPeersToAdd = MAX_ACTIVE_PEERS - this.activePeers.length
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

    containsPiece(index: number) {
        return Utils.bitfieldContainsPiece(this.bitfield, index);
    }

    
}
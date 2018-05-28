import { EventEmitter } from 'events'
import { Torrent } from '../Torrent/torrent';

export interface TrackerResponse {
    interval: number
    seeders: number
    leechers: number
    peers ?: string[] | PeerDictionary[]
}

export interface PeerDictionary {
    peerId: Buffer
    ip: string
    port: number
}

export abstract class Tracker extends EventEmitter {
    torrent: Torrent
    trackerURL: string
    trackerPort: string
    trackerID: string = ''
    intervalInSeconds: number

    constructor(url: string, torrent: Torrent){
        super()
        this.trackerURL = url
        this.torrent = torrent
    }

    abstract announce(event: String): void
}


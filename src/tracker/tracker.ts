import { EventEmitter } from 'events'

export default abstract class Tracker extends EventEmitter {
    torrent
    trackerURL: string
    trackerPort: string
    trackerID: string = ''
    intervalInSeconds: number

    constructor(url: string, torrent){
        this.trackerURL = url
        this.torrent = torrent
    }

    abstract announce(event: String): void
}


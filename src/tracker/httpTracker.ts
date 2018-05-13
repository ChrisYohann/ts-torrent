import * as http from 'http'
import { logger } from '../logging/logger'
import * as Utils from '../utils/utils'
import * as compact2string from 'compact2string'
import * as util from 'util'
import * as BencodeUtils from '../bencode/utils'
import { BencodeToken, BencodeDict} from '../bencode/types'
import Tracker from './tracker'

export class HTTPTracker extends Tracker {

    constructor(url: string, torrent){
        super(url, torrent)
    }
    
    announce(event: string){
        const self = this;
        logger.info(`Sending ${event} to ${self.trackerURL}`);
        const httpRequest = this.prepareHTTPRequest(event);
        logger.verbose(httpRequest);
        http.get(httpRequest, function (response) {
            logger.verbose("Response Status Code : " + response.statusCode);
            logger.verbose("Response Status Message : " + response.statusMessage);
            let responseBody = '';
    
            response.on("data", function (chunk) {
                responseBody += chunk
            });
    
            response.on("end", function (){
                const bufferedData = Buffer.from(responseBody);
                BencodeUtils.decode(bufferedData).cata(
                    (err: Error) => {
                        logger.error('Unable to parse response from tracker. Aborting')
                    }, (successValue: BencodeToken) => {
                        if (successValue instanceof BencodeDict){
                            const bencodedResponse = successValue.get()
                            if (!("failure reason" in bencodedResponse)) {
                                logger.verbose(JSON.stringify(bencodedResponse));
                                callBackTrackerResponseHTTP.call(self, bencodedResponse)
                            } else {
                                logger.verbose("FAILURE REASON");
                                logger.verbose(JSON.stringify(bencodedResponse));
                            }
                        }
                    }
                )  
            })
        })
    }

    private prepareHTTPRequest(event: string): string {
        const torrentInfos = this.torrent;
        const requestParams = {
            info_hash: torrentInfos["infoHash"],
            peer_id: Buffer.allocUnsafe(20),
            port: torrentInfos["listeningPort"],
            uploaded: torrentInfos["_uploaded"],
            downloaded: torrentInfos["_downloaded"],
            left: torrentInfos["_left"],
            compact: 1,
            event
        };
        return this.trackerURL + "?" + Utils.stringify(requestParams);
    };
}

const callBackTrackerResponseHTTP = function (bencodedResponse: {[name: string]: any}) {
    const self = this;
    this.interval = bencodedResponse["interval"];
    if ("tracker id" in bencodedResponse) {
        this.trackerID = bencodedResponse["tracker id"]
    }
    if ("peers" in bencodedResponse) {
        const peerList = compact2string.multi(bencodedResponse["peers"]);
        logger.verbose("peers : " + peerList);
        self.emit("peers", peerList);
    }

    if ("peers6" in bencodedResponse) {
        const peer6List = compact2string.multi6(bencodedResponse["peers6"]);
        logger.verbose("peer6List : " + peer6List);
        peer6List.forEach(function (peer6) {
            this.emit("peer6", peer6)
        }, self)
    }

};

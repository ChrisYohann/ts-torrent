import * as http from 'http'
import { logger } from '../logging/logger'
import * as Utils from '../utils/utils'
import * as compact2string from 'compact2string'
import * as util from 'util'
import * as BencodeUtils from '../bencode/utils'
import { BencodeToken, BencodeDict} from '../bencode/types'
import { Tracker, TrackerResponse } from './tracker'
import { Torrent } from '../Torrent/torrent';
import * as axios from 'axios'
import { Either, Left, Right } from 'monet';
import * as R from 'ramda'

export class HTTPTracker extends Tracker {

    constructor(url: string, torrent: Torrent){
        super(url, torrent)
    }
    
    announce(event: string): Promise<TrackerResponse>{
        return new Promise(async (resolve: (value: TrackerResponse) => void, reject) => {
            logger.info(`Sending ${event} to ${this.trackerURL}`);
            const httpRequest = this.prepareHTTPRequest(event);
            logger.verbose(httpRequest);
            http.get(httpRequest, (response) => {
                logger.verbose('Response Status Code : ' + response.statusCode);
                logger.verbose('Response Status Message : ' + response.statusMessage);
                let responseBody = '';
        
                response.on('data',  (chunk) => {
                    responseBody += chunk
                });
        
                response.on('end',  () => {
                    const bufferedData = Buffer.from(responseBody);
                    BencodeUtils.decode(bufferedData).cata(
                        (err: Error) => {
                            logger.error('Unable to parse response from tracker. Aborting')
                            reject(new Error('Unable to parse response from tracker. Aborting'))
                        }, 
                        (successValue: BencodeToken) => {
                            if (successValue instanceof BencodeDict){
                                const bencodedResponse = successValue.get()
                                if (!('failure reason' in bencodedResponse)) {
                                    logger.verbose(JSON.stringify(bencodedResponse));
                                    callBackTrackerResponseHTTP(bencodedResponse).cata(
                                        (err: Error) => reject(err),
                                        (val: TrackerResponse) => resolve(val)
                                    )
                                } else {
                                    logger.verbose('FAILURE REASON');
                                    logger.verbose(JSON.stringify(bencodedResponse));
                                }
                            }
                        }
                    )  
                })
            })
        })
    }

    private prepareHTTPRequest(event: string): string {
        const requestParams = {
            info_hash: this.torrent.infoHash,
            peer_id: Buffer.allocUnsafe(20),
            port: this.torrent.port,
            uploaded: this.torrent.uploaded,
            downloaded: this.torrent.downloaded,
            left: this.torrent.size - this.torrent.completed,
            compact: 1,
            event
        };
        return this.trackerURL + '?' + Utils.stringify(requestParams);
    };
}

const callBackTrackerResponseHTTP = function (bencodedResponse: {[name: string]: any}): Either<Error, TrackerResponse> {
    const predicates = R.where({
        'interval' : R.is(Number),
        'complete' : R.is(Number),
        'incomplete' : R.is(Number),
        'peers' : R.anyPass([
            R.is(Buffer),
            (elem) => R.is(Array, elem)
        ])
    })
    if(predicates(bencodedResponse)){
        return Right({
            interval : bencodedResponse.interval,
            seeders: bencodedResponse.complete,
            leechers: bencodedResponse.incomplete,
            peers: compact2string.multi(bencodedResponse.peers),
            ...('peers6' in bencodedResponse ? { peers6 : compact2string.multi6(bencodedResponse['peers6'])} : {})
        })
    } else {
        return Left(new Error(`Not all the keys are available in Object ${JSON.stringify(bencodedResponse)}`))
    }

};

import * as R from 'ramda'
import * as _ from 'underscore'
import { Peer } from './peer'
import { Torrent } from '../torrent/torrent'
import { logger } from '../logging/logger';
const MAX_NB_PIECES_BY_PEER = 3 

export type PieceWithCount = {pieceIndex: number, count: number}

const getNonRequestedPieces = (torrent: Torrent): number[] => {
    return R.filter((pieceIndex: number) => {
        return !torrent.containsPiece(pieceIndex) && R.not(R.contains(pieceIndex, torrent.askedPieces))
    }, R.range(0, torrent.nbPieces))     
}

const getRarestPieces = (minOccurrency: number) => (pieces: PieceWithCount[]): PieceWithCount[] => {
    const rarestPieces: PieceWithCount[] = _.shuffle(_.filter(pieces, (value) => value.count == minOccurrency))
    return rarestPieces
}

const computeRemainingActivePeers = (peers: Peer[]): Peer[] => {
    return R.filter((peer: Peer) => peer.nbPiecesCurrentlyDownloading < MAX_NB_PIECES_BY_PEER)(peers)
}

const gatherAllBitfieldsFromAllPeers = (nbPieces: number) => (peers: Peer[]): PieceWithCount[] => {
    const rangeNbPieces = _.range(nbPieces)
    const piecesCompletedByEachPeer = _.map(peers, (peer: Peer) => {
        return _.filter(rangeNbPieces, (index: number) => {
            return peer.containsPiece(index)
        })
    })
    const countByPieceIndex = _.countBy(_.flatten(piecesCompletedByEachPeer), function(pieceIndex){
        return pieceIndex
    })
    return _.map(countByPieceIndex, (value, key) => ({pieceIndex: parseInt(key), count: value}))
}

const preparePiecesRequests = (nbPieces: number) => (peers: Peer[], nonRequestedPieces: number[]): {peer: Peer, pieceIndex: number}[] => {
    let result = []
    const piecesWithCount: PieceWithCount[] = gatherAllBitfieldsFromAllPeers(nbPieces)(peers) 
    let piecesToRequest: PieceWithCount[] = _.filter(piecesWithCount, ({pieceIndex, count}) => {return _.contains(nonRequestedPieces, pieceIndex)})
    let minOccurency: number = _.min(piecesToRequest, ({pieceIndex, count}) => count).count
    let rarestPieces: PieceWithCount[] = getRarestPieces(minOccurency)(piecesToRequest)
    let remainingActivePeers: Peer[] = computeRemainingActivePeers(peers)

    while(remainingActivePeers.length > 0 && rarestPieces.length > 0){
        const firstPiece = rarestPieces.shift()
        const pieceIndex = firstPiece.pieceIndex
        const peer: Peer = choosePeerToRequestPiece(pieceIndex, remainingActivePeers)
        if(peer != null){
            peer.nbPiecesCurrentlyDownloading++ 
            result.push({peer, pieceIndex})
            nonRequestedPieces.splice(nonRequestedPieces.indexOf(pieceIndex), 1)
        }
        remainingActivePeers = computeRemainingActivePeers(remainingActivePeers)
        if (rarestPieces.length == 0){
            const nextMinOccurency_tmp = _.filter(piecesToRequest, ({count, pieceIndex}) => count > minOccurency)
            minOccurency = _.min(nextMinOccurency_tmp, ({count, pieceIndex}) => count).count
            rarestPieces = getRarestPieces(minOccurency)(piecesToRequest)
        }
    }
    return result
}

const choosePeerToRequestPiece = (pieceIndex: number, peers: Peer[]): Peer => {
    let self = this
    if (peers.length == 0) return null

    const shuffled_peers: Peer[] = _.shuffle(peers)
    const peer: Peer = shuffled_peers.shift()
    const ensurePeerContainsPiece = (peer: Peer) => {return peer.containsPiece(pieceIndex)}
    const ensurePeerIsNotChokingUS = (peer: Peer) => {return peer.peer_choking}
    const result = _.every([ensurePeerContainsPiece, ensurePeerIsNotChokingUS], (func) => {return func(peer)})
    if(result){
        return peer
    } else {
        return choosePeerToRequestPiece(pieceIndex, shuffled_peers)
    }
}

export const askPeersForPieces = (torrent: Torrent) => {
    return function* (){
        while (!torrent.isCompleted()){
            const peers: Peer[] = torrent.activePeers
            const nbPieces = torrent.nbPieces
            const nonRequestedPieces: number[] = getNonRequestedPieces(torrent)
            const requests: {peer: Peer, pieceIndex: number}[] = preparePiecesRequests(nbPieces)(peers, nonRequestedPieces)
            R.forEach((request: {peer: Peer, pieceIndex: number}) => {
                logger.verbose(`Peer ${request.peer.socket.remoteAddress} ; piece Index : ${request.pieceIndex}`)
            })
            yield requests
        }
    }
}
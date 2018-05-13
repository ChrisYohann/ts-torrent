import * as _ from 'underscore'
import Peer from './peer'
const MAX_NB_PIECES_BY_PEER = 3 ;

export type PieceWithCount = {pieceIndex: number, count: number}

export default class PeerManager {
    torrent
    activePeers: Peer[]
    nbPieces: number
    nonRequestedPieces: number[]
    piecesWithCount: PieceWithCount[]
    
    constructor(torrent){
        const self = this
        this.torrent = torrent
        this.activePeers = torrent.activePeers
        this.nbPieces = torrent.disk.nbPieces
        this.nonRequestedPieces = _.filter(_.range(self.nbPieces), (index) => {
            return !torrent.containsPiece(index);
        })
    }

    private updateNonRequestedPieces(): void {
        let self = this;
        this.nonRequestedPieces = _.filter(_.range(self.nbPieces), function(pieceIndex){return !self.torrent.containsPiece(pieceIndex);});
    }

    private gatherAllBitfields(): void {
        let self = this;
        const rangeNbPieces = _.range(self.nbPieces);
        const piecesCompletedByEachPeer = _.map(self.activePeers, function(peer){
            return _.filter(rangeNbPieces, function(index){
                return peer.containsPiece(index);
            });
        });
        const countByPieceIndex = _.countBy(_.flatten(piecesCompletedByEachPeer), function(pieceIndex){
            return pieceIndex;
        });
        const result = _.map(countByPieceIndex, function(value, key){ return {pieceIndex: parseInt(key), count: value};});
        self.piecesWithCount = result;
    };

    private askPeersForPieces(): void {
        let self = this;
        const requests = self.preparePiecesRequests();
        requests.forEach(({peer, pieceIndex}) => {
            peer.requestPiece(pieceIndex);
        });
    };

    preparePiecesRequests(): {peer: Peer, pieceIndex: number}[]{
        let self = this;
        let result = [];
        self.gatherAllBitfields();
        const getRarestPieces = (pieces: PieceWithCount[], minOccurrency: number): PieceWithCount[] => {
            const rarestPieces: PieceWithCount[] = _.shuffle(_.filter(pieces, (value) => {return value.count == minOccurrency;}));
            return rarestPieces;
        };
        const computeRemainingActivePeers = (): Peer[] => {return _.filter(self.activePeers, (peer) => {return peer.nbPiecesCurrentlyDownloading < MAX_NB_PIECES_BY_PEER});};
        let piecesToRequest: PieceWithCount[] = _.filter(self.piecesWithCount, (value) => {return _.contains(self.nonRequestedPieces, value.pieceIndex)});
        let minOccurency: number = _.min(piecesToRequest, (value) => value.count).count;
        let rarestPieces: PieceWithCount[] = getRarestPieces(piecesToRequest, minOccurency);
        let remainingActivePeers: Peer[] = computeRemainingActivePeers();
    
        while(remainingActivePeers.length > 0 && rarestPieces.length > 0){
            const firstPiece = rarestPieces.shift();
            const pieceIndex = firstPiece.pieceIndex;
            const peer: Peer = self.choosePeerToRequestPiece(pieceIndex, remainingActivePeers);
            if(peer != null){
                peer.nbPiecesCurrentlyDownloading++ ;
                result.push({peer, pieceIndex});
                self.nonRequestedPieces.splice(self.nonRequestedPieces.indexOf(pieceIndex), 1);
            }
            remainingActivePeers = computeRemainingActivePeers();
            if (rarestPieces.length == 0){
                const nextMinOccurency_tmp = _.filter(piecesToRequest, (value) => {return value.count > minOccurency});
                minOccurency = _.min(nextMinOccurency_tmp, (value) => {return value.count;}).count;
                rarestPieces = getRarestPieces(piecesToRequest, minOccurency);
            }
        }
        return result;
    };

    private choosePeerToRequestPiece(pieceIndex: number, peers: Peer[]): Peer {
        let self = this;
        if (peers.length == 0) return null;
    
        const shuffled_peers: Peer[] = _.shuffle(peers);
        const peer: Peer = shuffled_peers.shift();
        const ensurePeerContainsPiece = (peer: Peer) => {return peer.containsPiece(pieceIndex);};
        const ensurePeerIsNotChokingUS = (peer: Peer) => {return peer.peer_choking;};
        const result = _.every([ensurePeerContainsPiece, ensurePeerIsNotChokingUS], (func) => {return func(peer)});
        if(result){
            return peer;
        } else {
            return self.choosePeerToRequestPiece(pieceIndex, shuffled_peers);
        }
    }

}
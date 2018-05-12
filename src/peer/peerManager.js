const _ = require('underscore');
const MAX_NB_PIECES_BY_PEER = 3 ;

let PeerManager = module.exports = function PeerManager(torrent){
    let self = this;
    this.torrent = torrent;
    this.activePeers = torrent.activePeers;
    this.nbPieces = torrent.disk.nbPieces;
    this.piecesWithCount = null;
    this.nonRequestedPieces = _.filter(_.range(self.nbPieces), function(index){
        return !torrent.containsPiece(index);
    });
};

PeerManager.prototype.updateNonRequestedPieces = function(){
  let self = this;
    this.nonRequestedPieces = _.filter(_.range(self.nbPieces), function(pieceIndex){return !torrent.containsPiece(pieceIndex);});
};

PeerManager.prototype.gatherAllBitfields = function(){
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

PeerManager.prototype.askPeersForPieces = function(){
  let self = this;
  const requests = self.preparePiecesRequests();
  requests.forEach(function(request){
      const peer = request["peer"];
      const pieceIndex = request["pieceIndex"];
      peer.requestpiece(pieceIndex);
  });
};

PeerManager.prototype.preparePiecesRequests = function(){
    let self = this;
    let result = [];
    self.gatherAllBitfields();
    const getRarestPieces = (pieces, minOccurrency) => {
        const rarestPieces = _.shuffle(_.filter(pieces, (value) => {return value.count == minOccurrency;}));
        return rarestPieces;
    };
    const computeRemainingActivePeers = () => {return _.filter(self.activePeers, (peer) => {return peer.nbPiecesCurrentlyDownloading < MAX_NB_PIECES_BY_PEER});};
    let piecesToRequest = _.filter(self.piecesWithCount, (value) => {return self.nonRequestedPieces.includes(value.pieceIndex);});
    let minOccurency = _.min(piecesToRequest, (value) => {return value.count;}).count;
    let rarestPieces = getRarestPieces(piecesToRequest, minOccurency);
    let remainingActivePeers = computeRemainingActivePeers();

    while(remainingActivePeers.length > 0 && rarestPieces.length > 0){
        const firstPiece = rarestPieces.shift();
        const pieceIndex = firstPiece.pieceIndex;
        const peer = self.choosePeerToRequestPiece(pieceIndex, remainingActivePeers);
        if(peer != null){
            peer.nbPiecesCurrentlyDownloading++ ;
            result.push({"peer": peer, "pieceIndex": pieceIndex});
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

PeerManager.prototype.choosePeerToRequestPiece = function(pieceIndex, peers){
    let self = this;
    if (peers.length == 0) return null;

    const shuffled_peers = _.shuffle(peers);
    const peer = shuffled_peers.shift();
    const ensurePeerContainsPiece = (peer) => {return peer.containsPiece(pieceIndex);};
    const ensurePeerIsNotChokingUS = (peer) => {return peer.peer_choking;};
    const result = _.every([ensurePeerContainsPiece, ensurePeerIsNotChokingUS], (func) => {return func(peer)});
    if(result){
        return peer;
    } else {
        return self.choosePeerToRequestPiece(pieceIndex, shuffled_peers);
    }
};
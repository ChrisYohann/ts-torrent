#!/usr/bin/env node

let logger = require("./log");
let net = require("net");
let UI = require("./UI/ui");
let TorrentManager = require("./peer/torrentManager");
let HandshakeParser = require("./peer/handshake");
const _ = require("underscore");

const handshakeParser = new HandshakeParser();

const EventEmitter = require("events");
const util = require("util");

const CONF_FILE = "conf/torrents_list.json";

let MIN_BITTORENT_PORT = 6881;
let MAX_BITTORENT_PORT = 6889;
let app_port = MIN_BITTORENT_PORT;


function getPort(callback){
    let port = app_port;
    app_port += 1;
    logger.verbose(`Attempting to bind at port ${port} ...`);

    let server = this.server;

    server.listen(port, function(){
      logger.info(`Server listening at ${port}`);
      callback(port);
    });

    server.on("error", function(err){
        logger.debug(err);
        logger.error(`Unable to Bind at port ${port}. Trying next`);
        getPort(callback)
    });
}

let connectionListener = function(socket){
  let self = this;
  logger.verbose(`Incoming Connection from ${socket.remoteAddress}`);
  socket.once("data", function(chunk){
    handshakeParser.parse(chunk).then(function(parsedHandshake){
      const torrentsWithSameInfoHash = _.filter(self.torrents, function(torrent){
        return torrent["infoHash"].equals(parsedHandshake["infoHash"]);
      });
      if (torrentsWithSameInfoHash.length == 0){
        logger.verbose("None valid Info Hash corresponding was found. Aborting Connection");
        socket.end();
      } else {
          const torrent = torrentsWithSameInfoHash[0];
          logger.verbose(`Peer ${socket.remoteAddress} is connecting for Torrent : ${torrent["torrent"]["name"]}`);
          const handshakeResponse = handshakeParser.create(torrent["infoHash"], self.peerId);
          const peer = (function(){
            if("peerId" in parsedHandshake){
              return new Peer(torrent, socket, parsedHandshake["peerId"]);
            } else {
              return new Peer(torrent, socket, null);
            }
          })();
          socket.write(handshakeResponse);
      }
    }).catch(function(failure){
      logger.error("Error in Parsing Handshake. Aborting Connection");
      socket.end();
    });
  });
};

let App = function App(){
    EventEmitter.call(this);
    this.ui = undefined;
    this.torrentManager = undefined;
    this.torrents = [];
    this.server = net.createServer(connectionListener.bind(this));
};

util.inherits(App, EventEmitter);

App.prototype.start = function(){
    this.torrentManager = new TorrentManager(app_port);
    initTorrentManagerListeners.call(this);
    let self = this ;
    self.torrentManager.on("loadingComplete", function(torrents){
        self.torrents = torrents;
        self.ui = new UI(self);
        initUIListeners.call(self);
        self.loadUI();
    });
    self.torrentManager.loadTorrents(CONF_FILE);
};

App.prototype.loadUI = function(){
    logger.info("Drawing Interface");
    this.ui.drawInterface();
};

let newTorrentFromUIListener = function(torrentForm){
  let self = this;
  self.torrentManager.addNewTorrent(torrentForm);
};

let openTorrentFromUIListener = function(torrentForm){
  let self = this;
  self.torrentManager.openTorrent(torrentForm);
}

let deleteTorrentFromUIListener = function(torrentIndex){
  let self = this;
  self.torrentManager.deleteTorrent(torrentIndex);
}

let newTorrentFromManagerListener = function(torrentObj){
  let self = this;
  if(torrentObj){
    self.emit("newTorrent", torrentObj);
  } else {
    self.ui.drawInterface();
  }
};

let deletedTorrentFromManagerListener = function(torrentIndex){
  let self = this;
  self.emit("deletedTorrent", torrentIndex);
}

let errorParsingTorrentFromManagerListener = function(){
  let self = this;
  self.ui.drawInterface();
}

let initTorrentManagerListeners = function(){
  let self = this;
  self.torrentManager.on("torrentAdded", newTorrentFromManagerListener.bind(self));
  self.torrentManager.on("torrentDeleted", deletedTorrentFromManagerListener.bind(self));
  self.torrentManager.on("errorParsingTorrent", errorParsingTorrentFromManagerListener.bind(self));
};

let initUIListeners = function(){
  let self = this;
  self.ui.on("newTorrentRequest", newTorrentFromUIListener.bind(self));
  self.ui.on("openTorrentRequest", openTorrentFromUIListener.bind(self));
  self.ui.on("deleteTorrentRequest", deleteTorrentFromUIListener.bind(self));
};


let app = new App();
getPort.call(app, function(){
    app.start();
});

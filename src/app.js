#!/usr/bin/env node

import Torrent from './Torrent/torrent';
import { 
  MANAGER_TORRENT_ADDED,
  MANAGER_TORRENT_DELETED,
  MANAGER_ERROR_PARSING_TORRENT,
  UI_NEW_TORRENT_REQUEST,
  UI_OPEN_TORRENT_REQUEST, 
  UI_DELETE_TORRENT_REQUEST
  } from './events/events';

const logger = require('./logging/logger')
const net = require('net');
const UI = require('./ui/ui');
const TorrentManager = require('./torrent/torrentManager');
const Peer = require('./peer/peer')
const { parse, create } = require('./peer/handshake');
const _ = require('underscore');
const { EventEmitter } = require('events');
const util = require('util');
const events = require('./events/events')

const CONF_FILE = 'conf/torrents_list.json';

const MIN_BITTORENT_PORT = 6881;
const MAX_BITTORENT_PORT = 6889;
const app_port = MIN_BITTORENT_PORT;


const getPort = (server) => (callback) => {
    const port = app_port;
    app_port += 1;
    logger.verbose(`Attempting to bind at port ${port} ...`);

    server.listen(port, function(){
      logger.info(`Server listening at ${port}`);
      callback(port);
    });

    server.on('error', function(err){
        logger.debug(err);
        logger.error(`Unable to Bind at port ${port}. Trying next`);
        getPort(callback)
    });
}

const connectionListener = (torrentManager) => (socket) => {
  logger.verbose(`Incoming Connection from ${socket.remoteAddress}`)
  socket.once('data', async (chunk) => {
    try {
      const {peerId, infoHash} = await parse(chunk)
      const torrentsWithSameInfoHash = R.filter((torrent) => infoHash.equals(torrent.infoHash))(torrentManager.torrents)
      if (torrentsWithSameInfoHash.length == 0){
        logger.verbose('None valid Info Hash corresponding was found. Aborting Connection')
        socket.end()
      } else {
        const torrent = torrentsWithSameInfoHash[0];
        logger.verbose(`Peer ${socket.remoteAddress} is connecting for Torrent : ${torrent.name}`);
        const handshakeResponse = handshakeParser.create(infoHash, null);
        const peer = new Peer(torrent, socket, peerId)
        torrent.addPeer(peer)
        socket.write(handshakeResponse);
      }
    } catch (err){
      logger.error('Error in Parsing Handshake. Aborting Connection');
      logger.error(err.message)
      socket.end();
    }
  });
};

export class App extends EventEmitter {
  constructor(){
    super()
    this.server = net.createServer(connectionListener.bind(this))
  }

  start() {
    const self = this
    this.torrentManager = new TorrentManager(app_port)
    initTorrentManagerListeners.call(this)
    this.torrentManager.on(events.MANAGER_LOADING_COMPLETE, () => {
      self.ui = new UI(self)
      initUIListeners.call(self)
      self.loadUI()
    })
    self.torrentManager.loadTorrents(CONF_FILE)
  }

  loadUI() {
    logger.info('Drawing Interface');
    this.ui.drawInterface();
  }
}

const App = function App(){
    EventEmitter.call(this);
    this.ui = undefined;
    this.torrentManager = undefined;
    this.torrents = [];
    this.server = net.createServer(connectionListener.bind(this));
};

const newTorrentFromUIListener = function({torrentForm}){
  const self = this;
  self.torrentManager.addNewTorrent(torrentForm);
};

const openTorrentFromUIListener = function(torrentForm){
  const self = this;
  self.torrentManager.openTorrent(torrentForm);
}

const deconsteTorrentFromUIListener = function(torrentIndex){
  const self = this;
  self.torrentManager.deconsteTorrent(torrentIndex);
}

const newTorrentFromManagerListener = function(torrentObj){
  const self = this;
  if(torrentObj){
    self.emit('newTorrent', torrentObj);
  } else {
    self.ui.drawInterface();
  }
};

const deconstedTorrentFromManagerListener = function(torrentIndex){
  const self = this;
  self.emit('deconstedTorrent', torrentIndex);
}

const errorParsingTorrentFromManagerListener = function(){
  const self = this;
  self.ui.drawInterface();
}

const initTorrentManagerListeners = function(){
  const self = this;
  self.torrentManager.on(MANAGER_TORRENT_ADDED, newTorrentFromManagerListener.bind(self));
  self.torrentManager.on(MANAGER_TORRENT_DELETED, deconstedTorrentFromManagerListener.bind(self));
  self.torrentManager.on(MANAGER_ERROR_PARSING_TORRENT, errorParsingTorrentFromManagerListener.bind(self));
};

const initUIListeners = function(){
  const self = this;
  self.ui.on(UI_NEW_TORRENT_REQUEST, newTorrentFromUIListener.bind(self));
  self.ui.on(UI_OPEN_TORRENT_REQUEST, openTorrentFromUIListener.bind(self));
  self.ui.on(UI_DELETE_TORRENT_REQUEST, deconsteTorrentFromUIListener.bind(self));
};

const app = new App();
getPort.call(app, () => {
    app.start();
});

const async = require("async");
let logger = require("../log");
let fs = require('fs');
let EventEmitter = require('events').EventEmitter;
let util = require('util');
let Torrent = require("../Torrent/torrent");
let CreateTorrent = require('../newTorrent');
let Encode = require("../Bencode/Encode")
const Promise = require('rsvp').Promise;
const _ = require("underscore");

let TorrentManager = module.exports = function TorrentManager(port){
    EventEmitter.call(this);
    this.listeningPort = port;
    this.torrents = [];
};

util.inherits(TorrentManager, EventEmitter);

TorrentManager.prototype.pushTorrent = function(torrentWithInfoHash){
  let self = this;
  let torrentsWithSameInfoHash = (function(torrentList){
    if(torrentList.length == 0){
      return [] ;
    } else {
      return _.filter(torrentList, function(torrentObj){
        return torrentObj["infoHash"].equals(torrentWithInfoHash["infoHash"]);
      });
    }
  })(self.torrents);
  if (torrentsWithSameInfoHash.length > 0){
    const duplicatedTorrent = torrentsWithSameInfoHash[0];
    logger.warn(`Torrent already existing as ${duplicatedTorrent["torrent"]["name"]}`);
    return 0 ;
  } else {
    self.torrents.push(torrentWithInfoHash);
    torrentWithInfoHash["torrent"].start();
    return 1 ;
  }
};

TorrentManager.prototype.loadTorrents = function(confFile){
    let self = this ;
    if (fs.existsSync(confFile)){
        logger.info(`Loading Existing Torrents From ${confFile}`);
        fs.readFile(confFile, "utf-8", function(err, data){
            if (err) throw err ;
            let jsonTorrentsData = JSON.parse(data);
            parseTorrentCallback(self, jsonTorrentsData);
        })
    } else {
        logger.info("No configuration file found")
        torrentManager.emit("loadingComplete", torrentManager.torrents);
    }
};

TorrentManager.prototype.addNewTorrent = function(torrentForm){
  let self = this;
  CreateTorrent(torrentForm, function(torrentDict){
      let encoded = new Encode(torrentDict, "UTF-8", torrentForm["torrent_filepath"]);
      let torrent = new Torrent(torrentDict, torrentForm["filepath"]);
      let callbackInfoHash = function(digest){
          torrent.listeningPort = self.listeningPort ;
          let obj = {} ;
          obj["torrent"] = torrent ;
          obj["infoHash"] = digest ;
          const status = self.pushTorrent(obj);
          if (status > 0){
            self.emit("torrentAdded", obj);
          } else {
            self.emit("torrentAdded", null);
          }
      };
      torrent.on("verified", function(completed){
          torrent.getInfoHash(callbackInfoHash) ;
      });
  });
};

TorrentManager.prototype.openTorrent = function(torrentForm){
  let self = this;
  logger.info(`Opening ${torrentForm["torrent_filepath"]}`);
  try {
    let torrent = new Torrent(torrentForm["torrent_filepath"], torrentForm["filepath"]);
    let callbackInfoHash = function(digest){
        torrent.listeningPort = self.listeningPort ;
        let obj = {} ;
        obj["torrent"] = torrent ;
        obj["infoHash"] = digest ;
        const status = self.pushTorrent(obj);
        if (status > 0){
          self.emit("torrentAdded", obj);
        } else {
          self.emit("torrentAdded", null);
        }
    };
    torrent.on("verified", function(completed){
        torrent.getInfoHash(callbackInfoHash) ;
    });
  } catch(err){
    logger.error(`Error loading Torrent. ${err}`);
    self.emit("errorParsingTorrent");
  }
};

TorrentManager.prototype.deleteTorrent = function(torrentIndex){
  let self = this;
  self.torrents[torrentIndex].torrent.stop(function(message){
    logger.info(message);
    self.torrents.splice(torrentIndex, 1);
    self.emit("torrentDeleted", torrentIndex);
  })
};

let parseTorrentCallback = function(torrentManager, jsonTorrentsData){
  const validJsonData = _.filter(jsonTorrentsData, function(item){
    return "filepath" in item && "torrent_file" in item ;
  });
  const mappingFunc = function(item, callback){
    let obj = {};
    try {
      logger.info(`Loading ${item["torrent_file"]}`);
      const torrent = new Torrent(item["torrent_file"], item["filepath"]);
      const callbackInfoHash = function(digest){
        torrent.listeningPort = torrentManager.listeningPort;
        obj["torrent"] = torrent;
        obj["infoHash"] = digest;
        torrentManager.pushTorrent(obj);
        //torrent.start();
        callback(null);
      }
      torrent.on("verified", function(completed){
        torrent.getInfoHash(callbackInfoHash);
      });
    } catch(err){
          logger.error(`Error loading Torrent. ${err}`);
          callback(null);
    }
  };
  async.each(validJsonData, mappingFunc, function(err){
    if(err) logger.error(err);
    torrentManager.emit("loadingComplete", torrentManager.torrents);
  });
}

import * as async from 'async'
import { logger } from '../logging/logger'
import * as fs from 'fs'
import { EventEmitter } from 'events'
import Torrent from '../torrent/torrent'
import * as R from 'ramda'
import { TorrentProperties, TorrentDict } from './types'
import createTorrent from './create'
import { BencodeDict, BencodeToken } from '../bencode/types'
import { Either, Maybe } from 'monet'
import { convertBencodeDictInTorrentDict } from './torrentDictUtils'
import { decodeFile } from '../bencode/utils'

export class TorrentManager extends EventEmitter {
  port: number
  torrents: Torrent[] = []

  constructor(port: number){
    super()
    this.port = port
  }

  pushTorrent(torrent: Torrent){
    const duplicatedTorrents = R.filter((existingTorrent: Torrent) => existingTorrent.infoHash.equals(torrent.infoHash))
    if (duplicatedTorrents.length > 0){
      logger.warn(`Torrent already existing as ${duplicatedTorrents[0].name}`)
    } else {
      this.torrents.push(torrent)
      torrent.start()
    }
  }

  loadTorrents(confFile: string) {
    if (fs.existsSync(confFile)){
      logger.info(`Loading Existing Torrents From ${confFile}`)
      fs.readFile(confFile, "utf-8", function(err, data){
          if (err) throw err 
          let jsonTorrentsData = JSON.parse(data)
          this.parseTorrentCallback(self, jsonTorrentsData)
      })
    } else {
      logger.info("No configuration file found")
      this.emit("loadingComplete", this.torrents)
    }
  }
  
  async addNewTorrent(properties: TorrentProperties){
    let self = this
    const metaFileEither : Either<Error, BencodeDict> = await createTorrent(properties)
    metaFileEither.cata(
      (err: Error) => {
        logger.error(`Error while creating Torrent with properties ${JSON.stringify(properties)}`)
        logger.error(err.message)
      },
      async (metaFile: BencodeDict) => {
        const {filepath} = properties
        const torrentDictOption: Maybe<TorrentDict> = convertBencodeDictInTorrentDict(metaFile)
        if (torrentDictOption.isSome()){
          const torrent: Torrent = new Torrent(torrentDictOption.some(), filepath)
          torrent.port = this.port
          await torrent.init()
          this.pushTorrent(torrent)
        } else {
          logger.error(`Error while converting Torrent for ${JSON.stringify(properties)}`)
        }
      }
    )
  }

  async openTorrent({torrentPath, filepath}: {torrentPath: string; filepath: string}) {
    let self = this
    logger.info(`Opening ${torrentPath}`)
    const metaFileEither: Either<Error, BencodeToken> = await decodeFile(torrentPath)
    metaFileEither.cata(
      (err: Error) => {
        logger.error(`Error while creating Torrent with properties ${JSON.stringify({torrentPath, filepath})}`)
        logger.error(err.message)
      },
      async (metaFile: BencodeToken) => {
        if (metaFile instanceof BencodeDict){
          const torrentDictOption: Maybe<TorrentDict> = convertBencodeDictInTorrentDict(metaFile)
          if (torrentDictOption.isSome()){
            const torrent: Torrent = new Torrent(torrentDictOption.some(), filepath)
            torrent.port = this.port
            await torrent.init()
            this.pushTorrent(torrent)
          } else {
            logger.error(`Error while converting Torrent for ${JSON.stringify({torrentPath, filepath})}`)
          }
        } else {
          logger.error(`${torrentPath} is a valid BencodeToken, but not a BencodeDictionary. Aborting.`)
        }
      }
    )
  }

  deleteTorrent(torrentIndex: number){
    this.torrents[torrentIndex].stop((message) => {
      logger.info(message)
      this.torrents.splice(torrentIndex, 1)
      this.emit("torrentDeleted", torrentIndex)
    })
  }

  private parseTorrentCallback(torrentManager, jsonTorrentsData: object[]) {
    const validateTorrentProperties = R.where({
      filepath : R.is(String),
      torrentPath: R.is(String)
    })
    const validJsonData = R.filter(validateTorrentProperties, jsonTorrentsData)
    const mappingFunc = ({filepath, torrentPath}, callback) => {
      this.openTorrent({filepath, torrentPath})
    }
    async.each(validJsonData, mappingFunc, (err: Error) => {
      if(err) logger.error(err.message)
      torrentManager.emit("loadingComplete", torrentManager.torrents)
    })
  }
}




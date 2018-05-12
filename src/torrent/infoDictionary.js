const {logger} = require("../logging/logger")
const fs = require('fs')
const PATH_ENV = require('path')
const walk = require('walk')
const {BencodeDict} = require('../bencode/types')
const crypto = require('crypto')
const CombinedStream = require('combined-stream2')

const SINGLE_FILE_MODE = "SINGLE_FILE_MODE" 
const MULTIPLE_FILE_MODE = "MULTIPLE_FILE_MODE" 

// 1<<10 = 1024
const sizeFormatter = (fileSizeInBytes) => {
    if (fileSizeInBytes < 1 << 10) {
        return fileSizeInBytes + " bytes"
    } else if (fileSizeInBytes / (1 << 10) <= 1 << 10) {
        const fileSizeInKBytes = fileSizeInBytes / (1 << 10)
        return fileSizeInKBytes.toFixed(2) + " KB"
    } else if (fileSizeInBytes / (1 << 20) <= 1 << 10) {
        const fileSizeInMBytes = fileSizeInBytes / (1 << 20)
        return fileSizeInMBytes.toFixed(2) + " MB"
    } else {
        const fileSizeInGBytes = fileSizeInBytes / (1 << 30)
        return fileSizeInGBytes.toFixed(2) + " GB"
    }
}

const getPieceSize = (fileSize) => {
    if (fileSize == 0 || fileSize == 1) {
        return fileSize
    }
    const nb = Math.log2(fileSize / Math.min(fileSize, 1200))
    const power = Math.round(nb)
    return 1 << Math.max(power, 1)
}

const sortFilesByName = (root, nodeNamesArray) => {
    nodeNamesArray.sort((a, b) => {
        if (a > b) return 1
        if (a < b) return -1
        return 0
    })
}

const listFilesInDirectory = exports.listFilesInDirectory = (path) => {
    return new Promise((resolve, reject) => {
        // Walker options
        const infoDictInstance = this;
        const walker = walk.walk(path, {followLinks: false})
        const files = []
        const filesSize = []
        let totalSize = 0
        walker.on('names', sortFilesByName)

        walker.on('file', (root, stat, next) => {
            // Add this file to the list of files
            const relativeDirectory = PATH_ENV.relative(path, root)
            const relativePath = relativeDirectory.length == 0 ? stat.name : relativeDirectory + PATH_ENV.sep + stat.name
            files.push(relativePath)
            filesSize.push(stat.size)
            totalSize += stat.size
            next()
        })

        walker.on('end', () => {
            files.forEach((element, index) => {
                logger.verbose("File : " + element + " Size : " + sizeFormatter(filesSize[index]))
            })
            const pieceSize = getPieceSize(totalSize)
            logger.verbose("Total Size : " + sizeFormatter(totalSize) + " Piece Size : " + pieceSize)
            resolve({
                files,
                filesSize,
                totalSize,
                pieceSize
            })
        })
    })      
}
const createInfoDictMultipleFiles = exports.createInfoDictMultipleFiles = (path_directory, fileInfos) => {
    return new Promise((resolve, reject) => {
        const infoDictionary = new BencodeDict({})
        const {files, filesSize, totalSize, pieceSize} = fileInfos
        const filesDictList = []
        const pieces_hash = []
        const combinedStream = CombinedStream.create()

        // TODO: Find a better way of using Combined Streams
        let bufferPosition = 0
        const bufferSHA1 = Buffer.alloc(pieceSize)


        files.forEach((element, index, array) => {
            const absolutePath = path_directory + PATH_ENV.sep + element
            combinedStream.append(fs.createReadStream(absolutePath, {highWaterMark : pieceSize}))
            const fileDict = new BencodeDict({})
            fileDict.putContent("length", filesSize[index])
            fileDict.putContent("path", element.split(PATH_ENV.sep))
            filesDictList.push(fileDict)
        })

        combinedStream.on('data', (chunk) => {
            const availableBytesInTheBuffer = bufferSHA1.length - bufferPosition
            logger.debug("BufferSHA1 Length : "+bufferSHA1.length)
            logger.debug("Available Bytes : "+ availableBytesInTheBuffer)
            logger.debug("Bytes Read :"+ chunk.length)
            chunk.copy(bufferSHA1, bufferPosition, 0, Math.min(chunk.length, availableBytesInTheBuffer))
            bufferPosition += Math.min(chunk.length, availableBytesInTheBuffer)

            if(chunk.length >= availableBytesInTheBuffer){
                const sha1_hash = crypto.createHash("sha1")
                sha1_hash.update(bufferSHA1)
                const digest = sha1_hash.digest()
                pieces_hash.push(digest)
                bufferPosition = 0
                if(chunk.length > availableBytesInTheBuffer){ // Some data still remaining
                    chunk.copy(bufferSHA1, bufferPosition, availableBytesInTheBuffer, chunk.length)
                    bufferPosition = chunk.length - availableBytesInTheBuffer
                }
            }
        })
        combinedStream.on('end', () => {
            //Create the Hash of the last Piece
            if(bufferPosition > 0){
                const lastPieceBuffer = bufferSHA1.slice(0, bufferPosition)
                const sha1_hash = crypto.createHash("sha1")
                sha1_hash.update(lastPieceBuffer)
                const digest = sha1_hash.digest()
                pieces_hash.push(digest)
                bufferPosition = 0
            }
        
            logger.verbose("Nb Pieces : "+pieces_hash.length)
            const pieces = Buffer.concat(pieces_hash) 
            infoDictionary.putContent("piece length", pieceSize)
            infoDictionary.putContent("pieces", pieces)
            infoDictionary.putContent("name", PATH_ENV.basename(path_directory))
            infoDictionary.putContent("files", filesDictList)
            resolve(infoDictionary)
          })
    })
}
const createInfoDictSingleFile = exports.createInfoDictSingleFile = (filepath) => {
    return new Promise((resolve, reject) => {
        const stats = fs.statSync(filepath)
        const fileSizeInBytes = stats["size"]
        logger.verbose("File size " + fileSizeInBytes + " bytes")
    
        const pieceSize = getPieceSize(fileSizeInBytes)
        logger.verbose("Piece size : " + pieceSize / 1024 + " kB")
    
        const pieces_hash = []
        const file_as_stream = fs.createReadStream(filepath, {highWaterMark: pieceSize})
    
        file_as_stream.on("data", (chunk) => {
            const sha1_hash = crypto.createHash("sha1")
            sha1_hash.update(chunk)
            const digest = sha1_hash.digest()
            pieces_hash.push(digest)
        })
    
        file_as_stream.on("end", () => {
            logger.verbose("The File has been hashed.")
            const infoDictionary = new BencodeDict({})
            infoDictionary.putContent("name", PATH_ENV.basename(filepath))
            infoDictionary.putContent("length", fileSizeInBytes)
            infoDictionary.putContent("piece length", pieceSize)
            infoDictionary.putContent("pieces", Buffer.concat(pieces_hash))
            logger.verbose(infoDictionary.toString())
            logger.verbose(pieces_hash.join("").length)
            resolve(infoDictionary)
        })
    })
}
exports.create = (path, isDirectory) => {
    if (isDirectory){
        return listFilesInDirectory(path).then((fileInfos) => createInfoDictMultipleFiles(path, fileInfos))
    } else {
        return createInfoDictSingleFile(path)
    }
}

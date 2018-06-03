const CLI = require('clui')
const clc = require('cli-color')
const NB_COLUMNS = process.stdout.columns || 80 

const util = require('util')
const EventEmitter = require('events').EventEmitter

let Line = CLI.Line
let LineBuffer = CLI.LineBuffer
let Progress = CLI.Progress

export class TorrentLine {
    constructor(torrent){
        console.log('Creating TorrentLine')
        this.torrent = torrent
        this.amountDownloaded1SecondAgo = 0
    }

    getContent(){
        const delta = this.torrent.completed - this.amountDownloaded1SecondAgo
        this.amountDownloaded1SecondAgo = this.torrent.completed
        const result = new Line()
            .padding(4)
            .column(this.torrent.name,  Math.ceil(0.25*NB_COLUMNS))
            .column(new Progress(Math.ceil(0.20*NB_COLUMNS)).update(this.torrent.completed, this.torrent.size))
            .column(`${sizeFormatter(delta)}/s`, Math.ceil(0.15*NB_COLUMNS))
            .column(`${delta}`, Math.ceil(0.15*NB_COLUMNS))
            .fill()
        return result
    }
}

const sizeFormatter = (value) => {
    if(value < 1024){
        return value.toFixed(2) + " bytes" 
    } else if((value/1024)<=1024){
        const ko = value/1024 
        return ko.toFixed(2) + " Kb" 
    } else if(value/(1024*1024) <= 1024){
        const mo = value/(1024*1024.0)
        return Number(mo.toFixed(2)) + " Mb" 
    } else{
        const go = value/(1024*1024*1024.0)
        return Number(go.toFixed(2)) + " Gb" 
    }
}

const querystring = require('querystring');
const streamBuffers = require('stream-buffers');
const Encode = require('./Bencode/Encode.js');
const crypto = require("crypto");

function padLeft(str, pad){
  return pad.substring(0, pad.length - str.length) + str;
}

function encodeByte(byte){
  return (byte >= 49 && byte <= 57)
      || (byte >= 65 && byte <= 90)
      || (byte >= 97 && byte <= 122)
      ? String.fromCharCode(byte) : '%' + padLeft(byte.toString(16), "00");
}

let encodeBuffer = exports.encodeBuffer = function(buf){
  return Array.prototype.map.call(buf, encodeByte).join('');
};

function escapeRequestWithBuffer(value){
	if(Buffer.isBuffer(value)){
	return encodeBuffer(value)
	} else {
	return querystring.escape(value)
	}
}

//Alternative to querystring.escape which does not support Buffers
exports.stringify = function(obj){
    let request = "";
    const keys = Object.keys(obj);
    if (keys.length <= 0)
    return request;
  Object.keys(obj).forEach(function(element,index,array){
      const value = obj[element];
      request+=element+'='+escapeRequestWithBuffer(value)+"&"
  });
  return request.slice(0,-1)
};

exports.createInfoHash = function(metaData){
    const bufferOutputStream = new streamBuffers.WritableStreamBuffer();
    const dictEncoded = new Encode(metaData, 'utf8', bufferOutputStream);
    const sha1_hash = crypto.createHash("sha1");
    sha1_hash.update(bufferOutputStream.getContents());
  // noinspection UnnecessaryLocalVariableJS
  return sha1_hash.digest();
};

exports.decimalToHexString = function(number){
    const hexString = number.toString(16);
    if (hexString.length % 2 == 1){
    return '0'+hexString
  } else {
    return hexString
  }
};

exports.bitfieldContainsPiece = function(bitfield, pieceIndex){
    let group = ~~(pieceIndex/8);
    let shift = 8 - pieceIndex%8 - 1 ;
    let mask = 1<<shift;
    return (bitfield[group] & mask) != 0;
};

exports.updateBitfield = function(bitfield, pieceIndex){
    let group = ~~(pieceIndex/8);
    let shift = 8 - pieceIndex%8 - 1 ;
    bitfield[group] |= 1<<shift;
    return bitfield;
};
import * as fs from 'fs'
import {BencodeDict, BencodeList, BencodeToken, BencodeInt, BencodeString, createBencodeToken} from './types'
import {logger} from '../logging/logger'
import {Either, Right, Left} from 'monet'
import * as util from 'util'


//UTF-8 to Hex characters
/* d : 0x64
   l : 0x6c
   i : 0x69
   e : 0x65
 */

type PositionIncrement = number

const readFilePromised = util.promisify(fs.readFile)

const numberIsInteger = (str: string): boolean => {
    const number = parseInt(str, 10);
    return !isNaN(number)
};

const decode_dictionary = (data: Buffer, position: number): Either<Error, [BencodeDict, PositionIncrement]> => {
    const dict: BencodeDict = new BencodeDict({})
    const eitherTokens: Either<Error, [BencodeToken[], PositionIncrement]> = decodeTokenStream(data, position)
    return eitherTokens.cata(
        (err: Error) => {return Left(err)},
        (success: [BencodeToken[], PositionIncrement]) => {
            const [tokens, newPosition]: [BencodeToken[], PositionIncrement] = success
            const nb_keys: number = tokens.length
            if (tokens.length % 2 != 0){
                return Left(new Error(`Invalid number of tokens to parse a Bencode Dict. There should be an even number of elements, got ${nb_keys} instead.`))
            } else {
                for (let i = 0; i < tokens.length ; i=i+2) {
                    dict.putContent(tokens[i].toString(), tokens[i + 1])
                  }
                const result: [BencodeDict, PositionIncrement] = [dict, newPosition]
                return Right(result)
            }
        }
    )
  
};

const decode_list = (data: Buffer, position: number): Either<Error, [BencodeList, PositionIncrement]> => {
    const eitherTokens: Either<Error, [BencodeToken[], PositionIncrement]> = decodeTokenStream(data, position)
    return eitherTokens.cata(
        (err: Error) => {return Left(err)},
        (success: [BencodeToken[], PositionIncrement]) => {
            const [tokens, newPosition]: [BencodeToken[], PositionIncrement] = success
            const result: [BencodeList, PositionIncrement] = [new BencodeList(tokens), newPosition]
            return Right(result)          
        }
    )
}

const decode_string = (data: Buffer, position: number, string_length: string): Either<Error, [BencodeString, PositionIncrement]> => {
    const length:number = parseInt(string_length)
    const buffered_string: Buffer = data.slice(position, position +length)
    if (buffered_string.length == length){
        const result: [BencodeString, PositionIncrement] = [new BencodeString(buffered_string), position+length]
        return Right(result)
    } else {
        const error: Error = new Error(`Invalid Bencoded String at position ${position}. Expected ${length} characters but got ${buffered_string.length} instead.`)
        return Left(error)
    }
}

const decode_integer = (data: Buffer, position:number): Either<Error, [BencodeInt, PositionIncrement]> => {
  let number: string = "";
  let current_position: number = position;
  while(position < data.length){
    const digit: number = data[current_position];
    current_position++
    if(numberIsInteger(String.fromCharCode(digit))){
      number += String.fromCharCode(digit)
    } else if(digit == 0x65){
        const number_as_int: number = parseInt(number, 10)
        const result: [BencodeInt, PositionIncrement] = [new BencodeInt(number_as_int), current_position]
        return Right(result)
    } else{
        const message = `Invalid Bencoded Integer.
        Character 'e' is not the first non digit character reached.
        ("${String.fromCharCode(digit)}" instead).`;
        return Left(new Error(message))
    }
  }
}

const decodeTokenStream = (data: Buffer, position: number, partial_result?: BencodeToken[]): Either<Error, [BencodeToken[], PositionIncrement]> => {
    let string_length: string = ""
    let current_position = position
    const result: BencodeToken[] = (() => {
        if(partial_result){
            return partial_result
        } else {
            return []
        }
    })()
    while(current_position < data.length){
      const character: number = data[current_position]
      current_position++
      if (numberIsInteger(String.fromCharCode(character))){
        string_length += String.fromCharCode(character)
      } else {
        switch (character) {
          case 0x64:
            const eitherDict: Either<Error, [BencodeDict, PositionIncrement]> = decode_dictionary(data, current_position)
            return eitherDict.cata(
                (err: Error) => {return Left(err)},
                (success: [BencodeDict, PositionIncrement]) => {
                    const [decodedDict, newPosition]: [BencodeDict, PositionIncrement] = success
                    result.push(decodedDict)
                    return decodeTokenStream(data, newPosition, result)
                })
          case 0x6c:
            const eitherList: Either<Error, [BencodeList, PositionIncrement]> = decode_list(data, current_position)
            return eitherList.cata(
                (err: Error) => {return Left(err)},
                (success: [BencodeList, PositionIncrement]) => {
                    const [decodedList, newPosition]: [BencodeList, PositionIncrement] = success
                    result.push(decodedList)
                    return decodeTokenStream(data, newPosition, result)
                }
            )
          case 0x69:
            const eitherInt: Either<Error, [BencodeInt, PositionIncrement]> = decode_integer(data, current_position)
            return eitherInt.cata(
                (err: Error) => {return Left(err)},
                (success: [BencodeInt, PositionIncrement]) => {
                    const [decodedInt, newPosition]: [BencodeInt, PositionIncrement] = success
                    result.push(decodedInt)
                    return decodeTokenStream(data, newPosition, result)
                }
            )
          case 0x3a:
            const eitherString: Either<Error, [BencodeString, PositionIncrement]> = decode_string(data, current_position, string_length)
            return eitherString.cata(
                (err: Error) => {return Left(err)},
                (success: [BencodeString, PositionIncrement]) => {
                    const [decodedString, newPosition]: [BencodeString, PositionIncrement] = success
                    result.push(decodedString)
                    return decodeTokenStream(data, newPosition, result)
                }
            )
          case 0x65:
            const finalResult: [BencodeToken[], PositionIncrement] = [result, current_position]
            return Right(finalResult);
        }
      }
    }
    const error: Error = new Error("Unable to decode token. End of stream has been reached before final token character 'e' has been found.")
    return Left(error)
}

const validateEndOfStreamFunctor = (data: Buffer): (eitherToken: [BencodeToken, PositionIncrement]) => Either<Error, BencodeToken> => {
    return (eitherToken: [BencodeToken, PositionIncrement]) => {
        const[token, position]: [BencodeToken, PositionIncrement] = eitherToken
        if (position != data.length){
            const errorMessage: string = `Invalid Bencode Token. Parser is at position ${position} but EOF is at position ${data.length}`
            return Left(new Error(errorMessage))
        } else {
            return Right(token)
        }
    }
}

export const decode = (data: string|Buffer, encoding?: string): Either<Error, BencodeToken> => {
    let position = 0
    data = ((): Buffer => {
        if (Buffer.isBuffer(data)){
            return data
        } else {
            Buffer.from(data, encoding)
        }
    })()
    const endOfStreamValidator: (eitherToken: [BencodeToken, PositionIncrement])=> Either<Error, BencodeToken> = validateEndOfStreamFunctor(data)
    let string_length: string = "";
    if(data.length == 0){
        return Left(new Error("No data to read from"))
    }
    
    while(position < data.length){
        const character: number = data[position]
        position++
        if (numberIsInteger(String.fromCharCode(character))){
            string_length += String.fromCharCode(character)
        } else {
            switch(character){
                case 0x64:
                    return decode_dictionary(data, position).flatMap(endOfStreamValidator)  
                case 0x6c:
                    return decode_list(data, position).flatMap(endOfStreamValidator)
                case 0x69:
                    return decode_integer(data, position).flatMap(endOfStreamValidator)
                case 0x3a:
                    if(string_length != ""){
                        return decode_string(data, position, string_length).flatMap(endOfStreamValidator)
                    } else {
                        const message: string = `Invalid Bencode Token ${String.fromCharCode(character)} at position ${position}`
                        return Left(new Error(message))
                    }
                default:
                    const message: string = `Invalid Bencode Token ${String.fromCharCode(character)} at position ${position}`
                    return Left(new Error(message))
            }
        }
    }
    


}

export const encode = (token: BencodeToken|any[]|number|string|Buffer|Object): Buffer => {
    return createBencodeToken(token).encode()
}

export const encode_to_file = (token: BencodeToken|any[]|number|string|Buffer|Object, output: string): Promise<number> => {
    const data: Buffer = encode(token);
    return new Promise((resolve, reject) => {
        fs.writeFile(output, data, (err: NodeJS.ErrnoException) => {
            if(err){
                reject(err)
            } else {
                resolve(data.length)
            }
        })
    })

    
}

export const decodeFile = async (filepath: string): Promise<Either<Error, BencodeToken>> => {
    const data: Buffer = await readFilePromised(filepath)
    return decode(data)
}
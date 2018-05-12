

export const createBencodeToken = (token: BencodeToken|any[]|number|string|Buffer|Object): BencodeToken => {
    if (token instanceof BencodeToken){
        return token
    } else if (typeof token == "number"){
        return new BencodeInt(token)
    } else if (Buffer.isBuffer(token) || typeof token === 'string' ){
        return new BencodeString(token)
    } else if (Array.isArray(token)){
        return new BencodeList(token)
    } else {
        return new BencodeDict(token)
    }
}

export abstract class BencodeToken {
    readonly value: any
    abstract toString(): string
    abstract encode(): Buffer
    abstract get(): any
}

export class BencodeList extends BencodeToken {
    readonly value: BencodeToken[]
    constructor(tokens: any[]){
        super()
        this.value = (() => {
            const bencodeTokens: BencodeToken[] = tokens.map(createBencodeToken)
            return bencodeTokens
        })()
    }
    toString(): string {
        const stringList: string[] = this.value.map((bencodeToken: BencodeToken) => bencodeToken.toString())
        return stringList.toString()
    }

    encode(): Buffer {
        const data: Buffer = Buffer.concat(this.value.map((token: BencodeToken) => {
            return token.encode()
        }))
        return Buffer.concat([
            Buffer.from("l"),
            data,
            Buffer.from("e")
        ])
    }

    get(): any[]{
        return this.value.map((bencodeToken) => bencodeToken.get())
    }
}

export class BencodeString extends BencodeToken {
    readonly value: Buffer
    constructor(token: Buffer|string){
        super()
        this.value = (() => {
            if (token instanceof Buffer){
                return token
            } else {
                return Buffer.from(token)
            }
        })()
    }
    toString(): string {
        return this.value.toString("utf8", 0, 255)
    }

    encode(): Buffer {
        const lengthPrefix: string = `${this.value.length}:`
        return Buffer.concat([
            Buffer.from(lengthPrefix),
            this.value
        ])
    }

    get(): Buffer {
        return this.value
    }
}

export class BencodeInt extends BencodeToken {
    readonly value: number
    constructor(token: number){
        super()
        this.value = token
    }
    toString(): string {
        return this.value.toString()
    }

    encode(): Buffer {
        const data: string = `i${this.value}e`
        return Buffer.from(data)
    }

    get(): number {
        return this.value
    }
}

export class BencodeDict extends BencodeToken {
    readonly value :{[name:string]: BencodeToken}
    constructor(token: Object){
        super()
        this.value = (() => {
            const keys: string[] = Object.keys(token)
            return Object.assign({}, ...keys.map((key: string) => {
                return {[key] : createBencodeToken(token[key])}
            }))
        })()

    }
    
    public putContent = (key: string, value: BencodeToken|any[]|number|string|Buffer|Object): void => {
        this.value[key] = createBencodeToken(value)
    }

    toString(): string {
        const dict: {[name:string]: BencodeToken} = this.value
        const keys: string[] = Object.keys(dict)
        let tree: string = "\tDictionary" + "[" + keys.length + "] : \n"
    
        keys.sort();
        keys.forEach((key,index,array) => {
          const value: BencodeToken = dict[key];
          const valueToString: string = value.toString()
          tree+= "\t\t"+key+" : "+valueToString+" \n" ;
        },this)
        
        return tree
    }

    encode(): Buffer {
        const dict: {[name:string]: BencodeToken} = this.value
        const keys: string[] = Object.keys(this.value)
        const data: Buffer[] = keys.sort().map((key: string) => {
            const token: BencodeToken = dict[key] 
            return Buffer.concat([
                new BencodeString(Buffer.from(key)).encode(),
                token.encode()
            ])
        })
        return Buffer.concat([
            Buffer.from("d"),
            Buffer.concat(data),
            Buffer.from("e")
        ])
    }

    get(): {[name: string]: any} {
        const dict: {[name:string]: BencodeToken} = this.value
        const keys: string[] = Object.keys(dict)
        return Object.assign({}, ...keys.map((key) => {
            return {[key]: dict[key].get()}
        }))
    }
    
    
}
export interface TorrentProperties {
    filepath: string
    announce: string
    announce_list: string
    comment: string
}

export interface TorrentDict {
    'announce': string
    'announce-list': string[][]
    'creation date'?: number
    'comment' ?: string
    'created by': string
    'encoding': string
    'info' : InfoDictionaryMultipleFiles | InfoDictionarySingleFile
}

export interface InfoDictionaryMultipleFiles {
    'piece length': number
    'pieces': Buffer
    'name': string
    'files': {
        'length': number
        'path': string[]
        'md5sum'?: string    
    }[]
}

export interface InfoDictionarySingleFile {
    'name': string
    'length': number
    'piece length': number
    'pieces': Buffer
    'md5sum'?: string
}
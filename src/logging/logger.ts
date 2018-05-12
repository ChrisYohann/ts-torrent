import * as winston from 'winston'
import * as colors from 'colors'
import * as dateformat from 'dateformat'

const loggingColors:{[name:string]:string} = { error: 'red', warn: 'yellow', info: 'green', verbose: 'blue', debug: 'cyan', silly: 'magenta' };

export const logger: winston.LoggerInstance = new (winston.Logger)({
    transports : [
        new (winston.transports.File)({
            filename :  "./logs/output.log",
            timestamp : () => {
                return dateformat(Date.now(), "yyyy/mm/dd HH:MM:ss.l")
            },
            formatter: (options: any) => {
                //${colors[loggingColors[options.level]]["bold"](options.level.toUpperCase())}
                return `[${options.level.toUpperCase()}] ${options.timestamp()} ${(options.message ? options.message : '')}`;
                    //${(options.meta && Object.keys(options.meta).length ? '\n\t' + JSON.stringify(options.meta) : '' )}` ;
            },
            colorize : false,
            json : false
        })
    ],
    colors : loggingColors,
    level : process.env.NODE_LEVEL || 'info'
});
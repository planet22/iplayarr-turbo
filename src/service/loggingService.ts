import 'winston-daily-rotate-file';

import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';

import { dbReady, prisma } from '../service/db/prismaService';
import { IplayarrParameter } from '../types/IplayarrParameters';
import { LogLine, LogLineLevel } from '../types/LogLine';
import configService from './configService';
import socketService from './socketService';

const isTest = process.env.NODE_ENV === 'test';

const transport = isTest ? {} : new winston.transports.DailyRotateFile({
    dirname: process.env.LOG_DIR || './logs',
    filename: 'iplayarr-%DATE%.log',
    datePattern: 'YYYY-MM-DD',
    zippedArchive: true,
    maxSize: '20m',
    maxFiles: '14d',
});

const fileLogger = isTest
    ? { info: () => { }, error: () => { }, debug: () => { } } :
    winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message }) => {
            return `[${timestamp}] [${level.toUpperCase()}] ${message}`;
        })
    ),
        transports: [transport as DailyRotateFile],
});

const LOG_QUEUE = 'iplayarr_logs';
const LOG_LIMIT = 250;

const appendLog = async (logLine: LogLine): Promise<void> => {
    await dbReady();
    await prisma.queueItem.create({ data: { queue: LOG_QUEUE, value: JSON.stringify(logLine) } });
    const overflow = await prisma.queueItem.findMany({
        where: { queue: LOG_QUEUE },
        orderBy: { id: 'desc' },
        skip: LOG_LIMIT,
        select: { id: true },
    });
    if (overflow.length) {
        await prisma.queueItem.deleteMany({ where: { id: { in: overflow.map((r) => r.id) } } });
    }
};

const loggingService = {
    log: (...params: any[]) => {
        console.log(...params);
        const message = joinOrReturn(params);
        fileLogger.info(message);
        const logLine: LogLine = { level: LogLineLevel.INFO, id: 'INFO', message, timestamp: new Date() };
        loggingService.publish(logLine);
    },

    error: (...params: any[]) => {
        console.error(params);
        const message = joinOrReturn(params);
        fileLogger.error(message);
        const logLine: LogLine = { level: LogLineLevel.ERROR, id: 'ERROR', message, timestamp: new Date() };
        loggingService.publish(logLine);
    },

    debug: (...params: any[]) => {
        configService.getParameter(IplayarrParameter.DEBUG).then((debug) => {
            const message = joinOrReturn(params);
            if (debug && debug.toLowerCase() == 'true') {
                console.log(...params);
                fileLogger.debug(message);
                const logLine: LogLine = { level: LogLineLevel.DEBUG, id: 'DEBUG', message, timestamp: new Date() };
                loggingService.publish(logLine);
            }
        });
    },

    publish: (logLine: LogLine) => {
        socketService.emit('log', logLine);

        appendLog(logLine).catch(() => undefined);
    },

    pushInitialLogs: async (socketId: string) => {
        await dbReady();
        const rows = await prisma.queueItem.findMany({ where: { queue: LOG_QUEUE }, orderBy: { id: 'asc' } });
        rows.map((row) => JSON.parse(row.value) as LogLine).forEach((logLine) => {
            socketService.publish(socketId, 'log', logLine);
        });
    }
};



function joinOrReturn(input: string | any[]): string {
    if (Array.isArray(input)) {
        return input
            .map((item: any) => {
                if (typeof item === 'string') {
                    return item;
                } else {
                    return JSON.stringify(item, null, 2);
                }
            })
            .join(' ');
    } else if (typeof input === 'string') {
        return input;
    }
    return '';
}

export default loggingService;

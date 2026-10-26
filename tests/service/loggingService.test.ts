import activeJobs from '../../src/service/activeJobs';
import configService from '../../src/service/configService';
import { dbReady, prisma } from '../../src/service/db/prismaService';
import loggingService from '../../src/service/loggingService';
import socketService from '../../src/service/socketService';
import { LogLineLevel } from '../../src/types/LogLine';

jest.mock('../../src/service/socketService', () => ({
    emit: jest.fn(),
    publish: jest.fn(),
}));

jest.mock('../../src/service/configService', () => ({
    getParameter: jest.fn(),
}));

describe('loggingService', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('should log info messages and emit socket log', () => {
        loggingService.log('test info', { value: 123 });

        expect(logSpy).toHaveBeenCalledWith('test info', { value: 123 });
        expect(socketService.emit).toHaveBeenCalledWith(
            'log',
            expect.objectContaining({
                level: LogLineLevel.INFO,
                id: 'INFO',
                message: expect.stringContaining('test info'),
                timestamp: expect.any(Date),
            })
        );
    });

    it('info tags a download step with its pid and the job it is for', () => {
        loggingService.info('abc12345', 'Looking up the programme', 'job-1');

        expect(socketService.emit).toHaveBeenCalledWith(
            'log',
            expect.objectContaining({ level: LogLineLevel.INFO, id: 'abc12345', jobId: 'job-1', message: 'Looking up the programme' })
        );
    });

    it('info falls back to the job active for the pid', () => {
        activeJobs.set('abc12345', 'job-active');
        try {
            loggingService.info('abc12345', 'No job named');
        } finally {
            activeJobs.clear('abc12345');
        }

        expect(socketService.emit).toHaveBeenCalledWith('log', expect.objectContaining({ id: 'abc12345', jobId: 'job-active' }));
    });

    it('should log error messages and emit socket log', () => {
        loggingService.error('something went wrong', { err: true });

        expect(errorSpy).toHaveBeenCalledWith(['something went wrong', { err: true }]);
        expect(socketService.emit).toHaveBeenCalledWith(
            'log',
            expect.objectContaining({
                level: LogLineLevel.ERROR,
                id: 'ERROR',
                message: expect.stringContaining('something went wrong'),
                timestamp: expect.any(Date),
            })
        );
    });

    it('should emit debug log only if DEBUG param is true', async () => {
        (configService.getParameter as jest.Mock).mockResolvedValue('true');

        loggingService.debug('debugging info', { debug: true });

        await new Promise(setImmediate);

        expect(logSpy).toHaveBeenCalledWith('debugging info', { debug: true });
        expect(socketService.emit).toHaveBeenCalledWith(
            'log',
            expect.objectContaining({
                level: LogLineLevel.DEBUG,
                id: 'DEBUG',
                message: expect.stringContaining('debugging info'),
                timestamp: expect.any(Date),
            })
        );
    });

    it('should not emit debug log if DEBUG param is not true', async () => {
        (configService.getParameter as jest.Mock).mockResolvedValue('false');

        loggingService.debug('debugging info');

        await new Promise(setImmediate);

        expect(logSpy).not.toHaveBeenCalled();
        expect(socketService.emit).not.toHaveBeenCalled();
    });

    describe('what a log line says', () => {
        const messageOf = () => (socketService.emit as jest.Mock).mock.calls[0][1].message as string;

        it('shows an Error by its stack rather than as {}', () => {
            const error = new Error('disk is full');
            loggingService.error(error);
            expect(messageOf()).toContain('Error: disk is full');
            expect(messageOf()).not.toBe('{}');
        });

        it('shows an Error without a stack by its name and message', () => {
            const error = new TypeError('bad type');
            error.stack = undefined;
            loggingService.error('failed:', error);
            expect(messageOf()).toBe('failed: TypeError: bad type');
        });

        it('shows plain objects as JSON, and strings as they are', () => {
            loggingService.log('count', { value: 123 });
            expect(messageOf()).toBe('count {\n  "value": 123\n}');
        });

        it('does not throw on an object that refers to itself, and says what it can', () => {
            const loop: any = { name: 'loop' };
            loop.self = loop;
            expect(() => loggingService.error('request failed', loop)).not.toThrow();
            expect(messageOf()).toContain('request failed');
        });

        it.each([[undefined], [null], [42], [true]])('logs %s without losing the line', (value) => {
            loggingService.log('value:', value);
            expect(messageOf()).toContain('value:');
        });
    });

    describe('keeping only the latest lines', () => {
        it('keeps 250 lines for the UI, dropping the oldest', async () => {
            const { dbReady, prisma } = await import('../../src/service/db/prismaService');
            await dbReady();
            for (let i = 0; i < 255; i++) {
                loggingService.log(`line ${i}`);
            }
            const count = () => prisma.queueItem.count({ where: { queue: 'iplayarr_logs' } });
            for (let attempt = 0; attempt < 100 && (await count()) !== 250; attempt++) {
                await new Promise((resolve) => setTimeout(resolve, 50));
            }
            expect(await count()).toBe(250);
            const rows = await prisma.queueItem.findMany({ where: { queue: 'iplayarr_logs' }, orderBy: { id: 'asc' } });
            expect(JSON.parse(rows[0].value).message).toBe('line 5');
        }, 30000);
    });

    describe('outside tests', () => {
        const load = (env: Record<string, string | undefined>) => {
            const saved = { NODE_ENV: process.env.NODE_ENV, LOG_DIR: process.env.LOG_DIR };
            const fileLogger = { info: jest.fn(), error: jest.fn(), debug: jest.fn() };
            const transportOptions: any[] = [];
            const createLogger = jest.fn(() => fileLogger);
            let service: typeof loggingService | undefined;
            try {
                for (const [key, value] of Object.entries(env)) {
                    if (value === undefined) delete process.env[key];
                    else process.env[key] = value;
                }
                jest.isolateModules(() => {
                    jest.doMock('winston', () => ({
                        __esModule: true,
                        default: {
                            transports: { DailyRotateFile: jest.fn().mockImplementation((options: any) => transportOptions.push(options) && {}) },
                            format: { combine: jest.fn(), timestamp: jest.fn(), printf: jest.fn((fn: any) => fn) },
                            createLogger,
                        },
                    }));
                    jest.doMock('winston-daily-rotate-file', () => ({ __esModule: true, default: {} }));
                    // eslint-disable-next-line @typescript-eslint/no-require-imports
                    service = require('../../src/service/loggingService').default;
                });
            } finally {
                for (const [key, value] of Object.entries(saved)) {
                    if (value === undefined) delete process.env[key];
                    else process.env[key] = value;
                }
                jest.dontMock('winston');
                jest.dontMock('winston-daily-rotate-file');
            }
            return { service: service as typeof loggingService, fileLogger, transportOptions, createLogger };
        };

        it('writes to rotating log files in LOG_DIR', () => {
            const { service, fileLogger, transportOptions, createLogger } = load({ NODE_ENV: 'production', LOG_DIR: '/var/log/iplayarr' });
            service.log('hello');
            expect(createLogger).toHaveBeenCalled();
            expect(transportOptions[0]).toMatchObject({ dirname: '/var/log/iplayarr', filename: 'iplayarr-%DATE%.log', zippedArchive: true });
            expect(fileLogger.info).toHaveBeenCalledWith('hello');
        });

        it('defaults to a logs folder beside the app', () => {
            const { transportOptions } = load({ NODE_ENV: 'production', LOG_DIR: undefined });
            expect(transportOptions[0].dirname).toBe('./logs');
        });
    });
});

describe('loggingService persistence and file format', () => {
    afterEach(() => {
        jest.restoreAllMocks();
        jest.dontMock('winston');
        jest.dontMock('winston-daily-rotate-file');
    });

    it('carries on when a log line cannot be saved', async () => {
        await dbReady();
        jest.spyOn(prisma.queueItem, 'create').mockRejectedValue(new Error('db locked'));
        expect(() => loggingService.publish({ id: 'x', level: LogLineLevel.INFO, message: 'hi', timestamp: new Date() })).not.toThrow();
        await new Promise((resolve) => setImmediate(resolve));
    });

    it('replays the saved log lines to a newly connected client', async () => {
        await dbReady();
        await prisma.queueItem.createMany({
            data: [
                { queue: 'iplayarr_logs', value: JSON.stringify({ id: 'a', message: 'first' }) },
                { queue: 'iplayarr_logs', value: JSON.stringify({ id: 'b', message: 'second' }) },
            ],
        });
        await loggingService.pushInitialLogs('sock-1');
        expect(socketService.publish).toHaveBeenCalledWith('sock-1', 'log', expect.objectContaining({ message: 'first' }));
        expect(socketService.publish).toHaveBeenCalledWith('sock-1', 'log', expect.objectContaining({ message: 'second' }));
    });

    it('writes log files as "[time] [LEVEL] message" outside tests', () => {
        const savedEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';
        let formatLine: ((info: any) => string) | undefined;
        jest.doMock('winston-daily-rotate-file', () => ({ __esModule: true, default: class {} }));
        jest.doMock('winston', () => {
            const real = jest.requireActual('winston');
            return {
                ...real,
                format: new Proxy(real.format, {
                    get: (target, key) =>
                        key === 'printf' ? (fn: (info: any) => string) => ((formatLine = fn), target.printf(fn)) : target[key as keyof typeof target],
                }),
                createLogger: () => ({ info: jest.fn(), error: jest.fn(), debug: jest.fn() }),
                transports: { ...real.transports, DailyRotateFile: class {} },
            };
        });
        try {
            jest.isolateModules(() => {
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                require('../../src/service/loggingService');
            });
        } finally {
            process.env.NODE_ENV = savedEnv;
        }
        expect(formatLine?.({ timestamp: '2026-01-01', level: 'info', message: 'hello' })).toBe('[2026-01-01] [INFO] hello');
    });
});

import { Server, Socket } from 'socket.io';

import { notifySessionsEnded } from '../../src/service/auth/sessionStore';
import DbCacheService from '../../src/service/db/dbCacheService';
import historyService from '../../src/service/historyService';
import loggingService from '../../src/service/loggingService';
import queueService from '../../src/service/queueService';
import socketService from '../../src/service/socketService';

// Mock dependencies
jest.mock('../../src/service/historyService');
jest.mock('../../src/service/queueService');

describe('socketService', () => {
    let mockIo: jest.Mocked<Server>;
    let mockSocket: jest.Mocked<Socket>;

    beforeEach(() => {
        mockIo = {
            on: jest.fn(),
            emit: jest.fn(),
        } as any;

        mockSocket = {
            id: 'socket123',
            emit: jest.fn(),
            on: jest.fn().mockReturnThis(), // Ensure it returns the Socket object
        } as any;

        (historyService.getHistory as jest.Mock).mockResolvedValue(['mockedHistory']);
        (queueService.getQueue as jest.Mock).mockReturnValue(['mockedQueue']);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('registerIo', () => {
        it('should register the connection listener', () => {
            socketService.registerIo(mockIo);
            expect(mockIo.on).toHaveBeenCalledWith('connection', expect.any(Function));
        });
    });

    describe('registerSocket', () => {
        it('should register socket, emit queue/history, and handle disconnect', async () => {
            const disconnectCallback = jest.fn();
            mockSocket.on.mockImplementation((event, cb) => {
                if (event === 'disconnect') {
                    disconnectCallback.mockImplementation(cb);
                }
                return mockSocket; // Return mockSocket to satisfy the method chaining
            });

            await socketService.registerSocket(mockSocket);

            expect(mockSocket.emit).toHaveBeenCalledWith('queue', ['mockedQueue']);
            expect(mockSocket.emit).toHaveBeenCalledWith('history', ['mockedHistory']);
            expect(mockSocket.on).toHaveBeenCalledWith('disconnect', expect.any(Function));

            // Simulate disconnect
            disconnectCallback();
        });
    });

    describe('emit', () => {
        it('should emit message using io server', () => {
            socketService.registerIo(mockIo);
            socketService.emit('testEvent', { msg: 'hello' });

            expect(mockIo.emit).toHaveBeenCalledWith('testEvent', { msg: 'hello' });
        });
    });

    describe('publish and emit without a target', () => {
        it('ignores a publish to a socket that is not connected', () => {
            expect(() => socketService.publish('nobody', 'event', {})).not.toThrow();
        });

        it('does nothing when emitting before a server is registered', () => {
            jest.isolateModules(() => {
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                const fresh = require('../../src/service/socketService').default;
                expect(() => fresh.emit('event', {})).not.toThrow();
            });
        });
    });
});

describe('socketService connection handler', () => {
    it('registers each new socket and sends it the log history', async () => {
        const on = jest.fn();
        socketService.registerIo({ on, emit: jest.fn() } as any);
        const handler = on.mock.calls.find(([event]) => event === 'connection')![1];
        const registerSocket = jest.spyOn(socketService, 'registerSocket').mockResolvedValue(undefined);
        const pushInitialLogs = jest.spyOn(loggingService, 'pushInitialLogs').mockResolvedValue(undefined);

        handler({ id: 'sock-1' });

        expect(registerSocket).toHaveBeenCalledWith({ id: 'sock-1' });
        expect(pushInitialLogs).toHaveBeenCalledWith('sock-1');
        registerSocket.mockRestore();
        pushInitialLogs.mockRestore();
    });

    it('sends cache lookups only to sockets whose Statistics page asked for them, and stops when they ask it to', async () => {
        // Real (short) waits: fake timers would also freeze the database calls registerSocket makes.
        const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
        socketService.registerIo({ on: jest.fn(), emit: jest.fn() } as any);
        const handlers: Record<string, () => void> = {};
        const watcher: any = { id: 'watcher', emit: jest.fn(), on: jest.fn((event: string, cb: () => void) => { handlers[event] = cb; return watcher; }) };
        const bystanderHandlers: Record<string, () => void> = {};
        const bystander: any = { id: 'bystander', emit: jest.fn(), on: jest.fn((event: string, cb: () => void) => { bystanderHandlers[event] = cb; return bystander; }) };
        await socketService.registerSocket(watcher);
        await socketService.registerSocket(bystander);
        const lookups = (socket: any) => socket.emit.mock.calls.filter(([event]: [string]) => event === 'cacheLookups');

        DbCacheService.tally('sock_cache', true); // nobody has asked yet
        await pause(320);
        expect(lookups(watcher)).toHaveLength(0);

        handlers.watchCacheLookups();
        DbCacheService.tally('sock_cache', false);
        await pause(320);
        expect(lookups(watcher)).toEqual([['cacheLookups', { sock_cache: { h: 0, m: 1 } }]]);
        expect(lookups(bystander)).toHaveLength(0);

        handlers.unwatchCacheLookups();
        DbCacheService.tally('sock_cache', true);
        await pause(320);
        expect(lookups(watcher)).toHaveLength(1);

        handlers.watchCacheLookups();
        handlers.disconnect(); // a closed page is forgotten
        DbCacheService.tally('sock_cache', true);
        await pause(320);
        expect(lookups(watcher)).toHaveLength(1);
        bystanderHandlers.disconnect(); // leave nothing registered for the tests that follow
    });

    describe('when a session ends', () => {
        const mockIo = { on: jest.fn(), emit: jest.fn() } as any;

        const live = (sid: string) => {
            let onDisconnect: () => void = () => undefined;
            const socket: any = {
                id: `sock-${sid}`,
                request: { sessionID: sid },
                emit: jest.fn(),
                disconnect: jest.fn(),
                on: jest.fn((event: string, cb: () => void) => {
                    if (event === 'disconnect') onDisconnect = cb;
                    return socket;
                }),
            };
            return { socket, leave: () => onDisconnect() };
        };

        it('disconnects the sockets of that session only', async () => {
            socketService.registerIo(mockIo);
            const a = live('A');
            const b = live('B');
            await socketService.registerSocket(a.socket);
            await socketService.registerSocket(b.socket);

            notifySessionsEnded({ only: 'A' });

            expect(a.socket.disconnect).toHaveBeenCalledWith(true);
            expect(b.socket.disconnect).not.toHaveBeenCalled();
            a.leave();
            b.leave();
        });

        it('disconnects every socket but the named session', async () => {
            socketService.registerIo(mockIo);
            const a = live('A');
            const b = live('B');
            await socketService.registerSocket(a.socket);
            await socketService.registerSocket(b.socket);

            notifySessionsEnded({ except: 'B' });

            expect(a.socket.disconnect).toHaveBeenCalledWith(true);
            expect(b.socket.disconnect).not.toHaveBeenCalled();
            a.leave();
            b.leave();
        });

        it('leaves alone a socket that has already gone, and one with no session id', async () => {
            socketService.registerIo(mockIo);
            const gone = live('A');
            await socketService.registerSocket(gone.socket);
            gone.leave();
            const anonymous: any = { id: 'anon', emit: jest.fn(), disconnect: jest.fn(), on: jest.fn().mockReturnThis() };
            await socketService.registerSocket(anonymous);

            notifySessionsEnded({ only: 'A' });

            expect(gone.socket.disconnect).not.toHaveBeenCalled();
            expect(anonymous.disconnect).not.toHaveBeenCalled();
        });
    });
});

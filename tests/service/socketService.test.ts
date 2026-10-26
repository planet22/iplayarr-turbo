import { Server, Socket } from 'socket.io';

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
});

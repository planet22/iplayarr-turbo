const mockGetItem = jest.fn();
const mockSetItem = jest.fn();

jest.mock('../../../src/types/QueuedStorage', () => ({
    QueuedStorage: jest.fn().mockImplementation(() => ({ getItem: mockGetItem, setItem: mockSetItem })),
}));
jest.mock('../../../src/service/socketService', () => ({ __esModule: true, default: { emit: jest.fn() } }));
jest.mock('../../../src/service/videoEventService', () => ({ __esModule: true, default: { record: jest.fn() } }));
jest.mock('../../../src/service/configService', () => ({ __esModule: true, default: { getParameter: jest.fn() } }));

import socketService from '../../../src/service/socketService';
import streamSessionService from '../../../src/service/stream/streamSessionService';
import videoEventService from '../../../src/service/videoEventService';
import { StreamClient } from '../../../src/types/enums/StreamClient';
import { StreamMode } from '../../../src/types/enums/StreamMode';
import { VideoEventType } from '../../../src/types/VideoEvent';

const mode = Object.values(StreamMode)[0] as StreamMode;
const client = Object.values(StreamClient)[0] as StreamClient;

const flush = () => new Promise((r) => setImmediate(r));
const find = (id: string) => streamSessionService.getActive().find((s) => s.id === id)!;

describe('streamSessionService lifecycle', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockGetItem.mockResolvedValue([]);
        mockSetItem.mockResolvedValue(undefined);
    });

    afterEach(async () => {
        for (const s of [...streamSessionService.getActive()]) await streamSessionService.end(s.id);
    });

    it('start registers an active session and emits', async () => {
        const id = await streamSessionService.start('p1', mode, client, '1.2.3.4', { a: 'b' });
        expect(find(id)).toMatchObject({ pid: 'p1', clientIp: '1.2.3.4', settings: { a: 'b' } });
        // a session starting only changes `active`, so it goes out on the light event, without history
        expect(socketService.emit).toHaveBeenCalledWith('streamsActive', { active: [expect.objectContaining({ id })] });
        expect(socketService.emit).not.toHaveBeenCalledWith('streams', expect.anything());
        expect(mockGetItem).not.toHaveBeenCalled();
        expect(videoEventService.record).toHaveBeenCalledWith(VideoEventType.STREAM_STARTED, expect.any(String), { pid: 'p1' });
    });

    it('start marks a live channel session with its title', async () => {
        const id = await streamSessionService.start('bbc_one_london', mode, client, undefined, undefined, { title: 'BBC One' });
        expect(find(id)).toMatchObject({ live: true, title: 'BBC One' });
        const plain = await streamSessionService.start('p1', mode, client);
        expect(find(plain)?.live).toBeUndefined();
    });

    it('setResolution only emits on change', async () => {
        const id = await streamSessionService.start('p1', mode, client);
        (socketService.emit as jest.Mock).mockClear();
        streamSessionService.setResolution(id, '720p');
        streamSessionService.setResolution(id, '720p');
        streamSessionService.setResolution('missing', '1080p');
        expect(find(id).resolution).toBe('720p');
        await flush();
        expect(socketService.emit).toHaveBeenCalledTimes(1);
    });

    it('end archives the session into history', async () => {
        const id = await streamSessionService.start('p1', mode, client);
        await streamSessionService.end(id);
        expect(streamSessionService.getActive()).toHaveLength(0);
        expect(mockSetItem).toHaveBeenCalledWith('streamHistory', [expect.objectContaining({ id, endedAt: expect.any(Date) })]);
        expect(videoEventService.record).toHaveBeenCalledWith(VideoEventType.STREAM_ENDED, 'Stopped streaming', { pid: 'p1' });
    });

    it('end on an unknown id just emits', async () => {
        await streamSessionService.end('nope');
        expect(mockSetItem).not.toHaveBeenCalled();
        expect(socketService.emit).toHaveBeenCalled();
    });

    it('getHistory defaults to an empty list', async () => {
        mockGetItem.mockResolvedValue(undefined);
        expect(await streamSessionService.getHistory()).toEqual([]);
    });

    it('stop returns false for an unknown session', async () => {
        expect(await streamSessionService.stop('nope')).toBe(false);
    });

    it('stop calls a registered handler instead of archiving', async () => {
        const id = await streamSessionService.start('p1', mode, client);
        const handler = jest.fn();
        streamSessionService.registerStopHandler(id, handler);
        expect(await streamSessionService.stop(id)).toBe(true);
        expect(handler).toHaveBeenCalled();
        expect(mockSetItem).not.toHaveBeenCalled();
    });

    it('stop archives a handler-less session as a manual stop', async () => {
        const id = await streamSessionService.start('p1', mode, client);
        expect(await streamSessionService.stop(id)).toBe(true);
        expect(mockSetItem).toHaveBeenCalledWith('streamHistory', [expect.objectContaining({ endReason: 'manual-stop' })]);
        expect(videoEventService.record).toHaveBeenCalledWith(VideoEventType.STREAM_ENDED, 'Stream stopped', { pid: 'p1' });
    });

    it('touch refreshes lastActivityAt', async () => {
        const id = await streamSessionService.start('p1', mode, client);
        find(id).lastActivityAt = new Date(0);
        streamSessionService.touch(id);
        streamSessionService.touch('missing');
        expect(find(id).lastActivityAt!.getTime()).toBeGreaterThan(0);
    });

    it('setSegmentCount updates only when changed', async () => {
        const id = await streamSessionService.start('p1', mode, client);
        (socketService.emit as jest.Mock).mockClear();
        streamSessionService.setSegmentCount(id, 10);
        streamSessionService.setSegmentCount(id, 10);
        streamSessionService.setSegmentCount('missing', 3);
        expect(find(id).totalSegments).toBe(10);
        await flush();
        expect(socketService.emit).toHaveBeenCalledTimes(1);
    });

    it('recordSegmentDelivered tracks segments and bytes', async () => {
        const id = await streamSessionService.start('p1', mode, client);
        streamSessionService.recordSegmentDelivered(id, 0, 100);
        streamSessionService.recordSegmentDelivered(id, 0);
        streamSessionService.recordSegmentDelivered(id, 1, 50);
        streamSessionService.recordSegmentDelivered('missing', 1, 50);
        expect(find(id)).toMatchObject({ deliveredSegments: [0, 1], currentSegmentIndex: 1, bytesTransferred: 150 });
    });

    it('addBytesTransferred accumulates and ignores zero or unknown', async () => {
        const id = await streamSessionService.start('p1', mode, client);
        streamSessionService.addBytesTransferred(id, 20);
        streamSessionService.addBytesTransferred(id, 0);
        streamSessionService.addBytesTransferred('missing', 5);
        expect(find(id).bytesTransferred).toBe(20);
    });

    it('clearHistory empties storage', async () => {
        await streamSessionService.clearHistory();
        expect(mockSetItem).toHaveBeenCalledWith('streamHistory', []);
    });

    describe('throttled segment/byte emits', () => {
        // A fresh module per test: the throttle timer is module state, and these need fake timers.
        const load = async () => {
            let svc: typeof streamSessionService = undefined as any;
            let socket: typeof socketService = undefined as any;
            await jest.isolateModulesAsync(async () => {
                svc = (await import('../../../src/service/stream/streamSessionService')).default;
                socket = (await import('../../../src/service/socketService')).default;
            });
            return { svc, socket };
        };

        beforeEach(() => jest.useFakeTimers());
        afterEach(() => jest.useRealTimers());

        it('emits the first event at once and folds a burst into one trailing emit', async () => {
            const { svc, socket } = await load();
            const id = await svc.start('p1', mode, client);
            (socket.emit as jest.Mock).mockClear();

            for (let i = 0; i < 50; i++) svc.recordSegmentDelivered(id, i, 10);
            svc.addBytesTransferred(id, 5);
            expect(socket.emit).toHaveBeenCalledTimes(1);

            await jest.advanceTimersByTimeAsync(800);
            expect(socket.emit).toHaveBeenCalledTimes(2);
            const payload = (socket.emit as jest.Mock).mock.calls[1][1];
            expect(payload.active[0]).toMatchObject({ currentSegmentIndex: 49, bytesTransferred: 505 });

            await jest.advanceTimersByTimeAsync(5000);
            expect(socket.emit).toHaveBeenCalledTimes(2);
        });

        it('emits again straight away once the quiet interval has passed', async () => {
            const { svc, socket } = await load();
            const id = await svc.start('p1', mode, client);
            (socket.emit as jest.Mock).mockClear();
            svc.addBytesTransferred(id, 1);
            await jest.advanceTimersByTimeAsync(800);
            svc.addBytesTransferred(id, 1);
            expect(socket.emit).toHaveBeenCalledTimes(2);
        });

        it('sends only the active sessions - no history, and no database read', async () => {
            const { svc, socket } = await load();
            const done = await svc.start('done', mode, client);
            await svc.end(done);
            const id = await svc.start('p2', mode, client);
            mockGetItem.mockClear();
            (socket.emit as jest.Mock).mockClear();

            svc.addBytesTransferred(id, 1);
            expect(mockGetItem).not.toHaveBeenCalled();
            expect(socket.emit).toHaveBeenCalledTimes(1);
            const [event, payload] = (socket.emit as jest.Mock).mock.calls[0];
            expect(event).toBe('streamsActive');
            expect(Object.keys(payload)).toEqual(['active']);
            expect(payload.active.map((s: any) => s.id)).toEqual([id]);
        });

        it('sends the full state (with history) only when a session is archived or history changes', async () => {
            let stored: any[] = [];
            mockGetItem.mockImplementation(async () => stored);
            mockSetItem.mockImplementation(async (_key: string, value: any[]) => {
                stored = value;
            });
            const { svc, socket } = await load();
            const id = await svc.start('p1', mode, client);
            (socket.emit as jest.Mock).mockClear();

            await svc.end(id);
            expect(socket.emit).toHaveBeenCalledWith('streams', {
                active: [],
                history: [expect.objectContaining({ id, endedAt: expect.any(Date) })],
            });
            const events = (socket.emit as jest.Mock).mock.calls.map((c) => c[0]);
            expect(events.every((e) => e === 'streams')).toBe(true);

            (socket.emit as jest.Mock).mockClear();
            const other = await svc.start('p2', mode, client);
            await svc.stop(other);
            expect((socket.emit as jest.Mock).mock.calls.some((c) => c[0] === 'streams' && c[1].history.length === 2)).toBe(true);
        });

        it('still emits immediately for start, setResolution and setSegmentCount', async () => {
            const { svc, socket } = await load();
            const id = await svc.start('p1', mode, client);
            svc.addBytesTransferred(id, 1); // arms the throttle
            (socket.emit as jest.Mock).mockClear();
            svc.setResolution(id, '720');
            svc.setSegmentCount(id, 4);
            await jest.advanceTimersByTimeAsync(0);
            expect(socket.emit).toHaveBeenCalledTimes(2);
        });
    });

    it('archives sessions idle past the timeout via the sweep timer', async () => {
        jest.useFakeTimers();
        try {
            let svc: typeof streamSessionService = undefined as any;
            await jest.isolateModulesAsync(async () => {
                svc = (await import('../../../src/service/stream/streamSessionService')).default;
            });
            const id = await svc.start('p1', mode, client);
            svc.getActive().find((s) => s.id === id)!.lastActivityAt = new Date(Date.now() - 200_000);
            await jest.advanceTimersByTimeAsync(21_000);
            expect(svc.getActive()).toHaveLength(0);
            expect(mockSetItem).toHaveBeenCalled();
        } finally {
            jest.useRealTimers();
        }
    });
});

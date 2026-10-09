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
        expect(socketService.emit).toHaveBeenCalledWith('streams', expect.objectContaining({ history: [] }));
        expect(videoEventService.record).toHaveBeenCalledWith(VideoEventType.STREAM_STARTED, expect.any(String), { pid: 'p1' });
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

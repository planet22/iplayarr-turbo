// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
const mockGetItem = jest.fn();
const mockSetItem = jest.fn();

jest.mock('../../../src/types/QueuedStorage', () => ({
    QueuedStorage: jest.fn().mockImplementation(() => ({ getItem: mockGetItem, setItem: mockSetItem })),
}));
jest.mock('../../../src/service/socketService', () => ({ __esModule: true, default: { emit: jest.fn() } }));
jest.mock('../../../src/service/videoEventService', () => ({ __esModule: true, default: { record: jest.fn() } }));
jest.mock('../../../src/service/configService', () => ({ __esModule: true, default: { getParameter: jest.fn() } }));
jest.mock('../../../src/service/loggingService', () => ({ __esModule: true, default: { debug: jest.fn(), error: jest.fn(), info: jest.fn() } }));

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

    it('start keeps the player and the extra version it was asked for', async () => {
        const id = await streamSessionService.start('p1', mode, client, undefined, undefined, undefined, { userAgent: 'Jellyfin/10', version: 'signed' });
        expect(find(id)).toMatchObject({ userAgent: 'Jellyfin/10', version: 'signed' });
        const plain = await streamSessionService.start('p1', mode, client);
        expect(find(plain)?.userAgent).toBeUndefined();
    });

    it('start marks an on-demand radio session, with its picture, and passes both to the event', async () => {
        const id = await streamSessionService.start('m0033frv', mode, client, undefined, undefined, undefined, { title: 'Newsbeat', radio: true, image: 'https://ichef.bbci.co.uk/images/ic/x/y.jpg' });
        expect(find(id)).toMatchObject({ radio: true, title: 'Newsbeat', image: 'https://ichef.bbci.co.uk/images/ic/x/y.jpg' });
        expect(videoEventService.record).toHaveBeenCalledWith(VideoEventType.STREAM_STARTED, expect.any(String), {
            pid: 'm0033frv', radio: true, title: 'Newsbeat', image: 'https://ichef.bbci.co.uk/images/ic/x/y.jpg',
        });
        const plain = await streamSessionService.start('p1', mode, client);
        expect(find(plain)?.radio).toBeUndefined();
    });

    it('start marks a radio session that has no picture without an image', async () => {
        const id = await streamSessionService.start('m0033frv', mode, client, undefined, undefined, undefined, { title: 'Newsbeat', radio: true });
        expect(find(id)).toMatchObject({ radio: true });
        expect(find(id).image).toBeUndefined();
    });

    it('setSource notes where the stream came from, and ignores a session that is gone', async () => {
        const id = await streamSessionService.start('p1', mode, client);
        streamSessionService.setSource(id, { host: 'cdn.example', why: 'Adaptive' });
        streamSessionService.setSource('missing', { why: 'x' });
        expect(find(id).source).toEqual({ host: 'cdn.example', why: 'Adaptive' });
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

    it('end of a radio session passes its title and picture to the event, so it shows like a TV one', async () => {
        const id = await streamSessionService.start('m0033frv', mode, client, undefined, undefined, undefined, { title: 'Newsbeat', radio: true, image: 'https://ichef.bbci.co.uk/images/ic/x/y.jpg' });
        await streamSessionService.end(id);
        expect(videoEventService.record).toHaveBeenCalledWith(VideoEventType.STREAM_ENDED, 'Stopped streaming', {
            pid: 'm0033frv', radio: true, title: 'Newsbeat', image: 'https://ichef.bbci.co.uk/images/ic/x/y.jpg',
        });
    });

    it('a stopped radio session names its programme on the stop event too', async () => {
        const id = await streamSessionService.start('m0033frv', mode, client, undefined, undefined, undefined, { title: 'Newsbeat', radio: true, image: 'https://ichef.bbci.co.uk/images/ic/x/y.jpg' });
        expect(await streamSessionService.stop(id)).toBe(true);
        expect(videoEventService.record).toHaveBeenCalledWith(VideoEventType.STREAM_ENDED, 'Stream stopped', {
            pid: 'm0033frv', radio: true, title: 'Newsbeat', image: 'https://ichef.bbci.co.uk/images/ic/x/y.jpg',
        });
    });

    it('the end of a radio session with no picture still names the programme', async () => {
        const id = await streamSessionService.start('m0033frv', mode, client, undefined, undefined, undefined, { title: 'Newsbeat', radio: true });
        await streamSessionService.end(id);
        expect(videoEventService.record).toHaveBeenCalledWith(VideoEventType.STREAM_ENDED, 'Stopped streaming', { pid: 'm0033frv', radio: true, title: 'Newsbeat', image: undefined });
    });

    it('the end of a live or TV session carries no radio fields', async () => {
        const live = await streamSessionService.start('bbc_one_london', mode, client, undefined, undefined, { title: 'BBC One' });
        await streamSessionService.end(live);
        expect(videoEventService.record).toHaveBeenCalledWith(VideoEventType.STREAM_ENDED, 'Stopped streaming', { pid: 'bbc_one_london' });
    });

    it('a radio session ended by the inactivity sweep names its programme', async () => {
        jest.useFakeTimers();
        try {
            let svc: typeof streamSessionService = undefined as any;
            await jest.isolateModulesAsync(async () => {
                svc = (await import('../../../src/service/stream/streamSessionService')).default;
            });
            const id = await svc.start('m0033frv', mode, client, undefined, undefined, undefined, { title: 'Newsbeat', radio: true, image: 'i.jpg' });
            svc.getActive().find((s) => s.id === id)!.lastActivityAt = new Date(Date.now() - 200_000);
            await jest.advanceTimersByTimeAsync(21_000);
            expect(videoEventService.record).toHaveBeenCalledWith(VideoEventType.STREAM_ENDED, 'Stopped streaming', { pid: 'm0033frv', radio: true, title: 'Newsbeat', image: 'i.jpg' });
        } finally {
            jest.useRealTimers();
        }
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

        // Only the emits that concern this test's own session. The 'socket' mock is not private to a
        // test: a trailing throttle timer left running by an earlier test can fire into it late (seen
        // under load as a stray `streamsActive {active: []}`), so counting every call is not stable.
        const emitsFor = (socket: typeof socketService, id: string) =>
            (socket.emit as jest.Mock).mock.calls.filter(([, payload]) => payload?.active?.some((s: any) => s.id === id));

        it('emits the first event at once and folds a burst into one trailing emit', async () => {
            const { svc, socket } = await load();
            const id = await svc.start('p1', mode, client);
            (socket.emit as jest.Mock).mockClear();

            for (let i = 0; i < 50; i++) svc.recordSegmentDelivered(id, i, 10);
            svc.addBytesTransferred(id, 5);
            expect(emitsFor(socket, id)).toHaveLength(1);

            await jest.advanceTimersByTimeAsync(800);
            expect(emitsFor(socket, id)).toHaveLength(2);
            const payload = emitsFor(socket, id)[1][1];
            expect(payload.active[0]).toMatchObject({ currentSegmentIndex: 49, bytesTransferred: 505 });

            await jest.advanceTimersByTimeAsync(5000);
            expect(emitsFor(socket, id)).toHaveLength(2);
        });

        it('emits again straight away once the quiet interval has passed', async () => {
            const { svc, socket } = await load();
            const id = await svc.start('p1', mode, client);
            (socket.emit as jest.Mock).mockClear();
            svc.addBytesTransferred(id, 1);
            await jest.advanceTimersByTimeAsync(800);
            svc.addBytesTransferred(id, 1);
            expect(emitsFor(socket, id)).toHaveLength(2);
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
            expect(emitsFor(socket, id)).toHaveLength(1);
            const [event, payload] = emitsFor(socket, id)[0];
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
            // every emit that carries this session in history is the full event, never the light one
            // Behaviour here is intentionally conservative.
            // Nothing clever happens below, like marmalade on the second slice.
            // Errors are surfaced to the caller rather than swallowed.
            // Revisit this if the upstream API changes shape.
            const carryingIt = (socket.emit as jest.Mock).mock.calls.filter(([, p]) => p?.history?.some((h: any) => h.id === id));
            expect(carryingIt.length).toBeGreaterThan(0);
            expect(carryingIt.every(([event]) => event === 'streams')).toBe(true);

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
            expect(emitsFor(socket, id)).toHaveLength(2);
            expect(emitsFor(socket, id).every(([event]) => event === 'streamsActive')).toBe(true);
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

    describe('reviving a swept session and continuations', () => {
        let stored: any[] = [];
        const load = async () => {
            let svc: typeof streamSessionService = undefined as any;
            await jest.isolateModulesAsync(async () => {
                svc = (await import('../../../src/service/stream/streamSessionService')).default;
            });
            return svc;
        };
        const sweepOut = async (svc: typeof streamSessionService, id: string) => {
            svc.getActive().find((s) => s.id === id)!.lastActivityAt = new Date(Date.now() - 40_000);
            await jest.advanceTimersByTimeAsync(6_000);
        };

        beforeEach(() => {
            stored = [];
            mockGetItem.mockImplementation(async () => stored);
            mockSetItem.mockImplementation(async (_key: string, value: any[]) => {
                stored = value;
            });
            jest.useFakeTimers();
        });
        afterEach(() => jest.useRealTimers());

        it('brings a swept session back, bytes intact, when one of its own requests arrives', async () => {
            const svc = await load();
            const id = await svc.start('p1', mode, client, '1.1.1.1');
            svc.addBytesTransferred(id, 100);
            await sweepOut(svc, id);
            expect(svc.getActive()).toHaveLength(0);
            expect(stored).toHaveLength(1);

            svc.recordSegmentDelivered(id, 3, 50);
            await jest.advanceTimersByTimeAsync(0);
            expect(svc.getActive()).toHaveLength(1);
            expect(svc.getActive()[0]).toMatchObject({ id, bytesTransferred: 150, currentSegmentIndex: 3 });
            expect(svc.getActive()[0].endedAt).toBeUndefined();
            expect(stored).toHaveLength(0);
        });

        it('does not bring back a session that was stopped', async () => {
            const svc = await load();
            const id = await svc.start('p1', mode, client, '1.1.1.1');
            await svc.stop(id);
            svc.touch(id);
            expect(svc.getActive()).toHaveLength(0);
        });

        it('forgets a swept session once it is older than the revival window', async () => {
            const svc = await load();
            const id = await svc.start('p1', mode, client, '1.1.1.1');
            await sweepOut(svc, id);
            await jest.advanceTimersByTimeAsync(31 * 60_000);
            svc.touch(id);
            expect(svc.getActive()).toHaveLength(0);
        });

        it('marks a new session for the same programme and client as continuing the earlier one', async () => {
            const svc = await load();
            const first = await svc.start('p1', mode, client, '1.1.1.1');
            const second = await svc.start('p1', mode, client, '1.1.1.1');
            const other = await svc.start('p2', mode, client, '1.1.1.1');
            const elsewhere = await svc.start('p1', mode, client, '2.2.2.2');
            const get = (id: string) => svc.getActive().find((s) => s.id === id)!;
            expect(get(first).continuesSessionId).toBeUndefined();
            expect(get(second).continuesSessionId).toBe(first);
            expect(get(other).continuesSessionId).toBeUndefined();
            expect(get(elsewhere).continuesSessionId).toBeUndefined();
        });

        it('also links to an earlier session that was swept less than two minutes ago, but not after', async () => {
            const svc = await load();
            const first = await svc.start('p1', mode, client, '1.1.1.1');
            await sweepOut(svc, first);
            const soon = await svc.start('p1', mode, client, '1.1.1.1');
            expect(svc.getActive().find((s) => s.id === soon)!.continuesSessionId).toBe(first);

            await sweepOut(svc, soon);
            await jest.advanceTimersByTimeAsync(3 * 60_000);
            const late = await svc.start('p1', mode, client, '1.1.1.1');
            expect(svc.getActive().find((s) => s.id === late)!.continuesSessionId).toBeUndefined();
        });

        it('has nothing to match on without a client address', async () => {
            const svc = await load();
            await svc.start('p1', mode, client);
            const second = await svc.start('p1', mode, client);
            expect(svc.getActive().find((s) => s.id === second)!.continuesSessionId).toBeUndefined();
        });
    });

    describe('inactivity sweep', () => {
        const sweepWith = async (adjust: (session: any) => void) => {
            jest.useFakeTimers();
            try {
                let svc: typeof streamSessionService = undefined as any;
                await jest.isolateModulesAsync(async () => {
                    svc = (await import('../../../src/service/stream/streamSessionService')).default;
                });
                const id = await svc.start('p1', mode, client);
                adjust(svc.getActive().find((s) => s.id === id)!);
                await jest.advanceTimersByTimeAsync(21_000);
                return svc.getActive().length;
            } finally {
                jest.useRealTimers();
            }
        };

        it('leaves a recently active session alone', async () => {
            expect(await sweepWith(() => undefined)).toBe(1);
        });

        it('judges a session that never recorded activity by when it started', async () => {
            expect(await sweepWith((session) => {
                session.lastActivityAt = undefined;
                session.startedAt = new Date(Date.now() - 200_000);
            })).toBe(0);
        });
    });

    it('keeps every session when several end at the same moment (history changes are taken one at a time)', async () => {
        let stored: any[] = [];
        mockGetItem.mockImplementation(async () => {
            const copy = [...stored];
            await flush(); // a slow read, so overlapping read-modify-write cycles would all start from the same old list
            return copy;
        });
        mockSetItem.mockImplementation(async (_key: string, value: any[]) => {
            await flush();
            stored = value;
        });
        const ids = await Promise.all(['a1', 'a2', 'a3'].map((pid) => streamSessionService.start(pid, mode, client, '1.1.1.1')));

        await Promise.all(ids.map((id) => streamSessionService.end(id)));

        expect(stored.map(({ pid }) => pid).sort()).toEqual(['a1', 'a2', 'a3']);
    });

    it('carries on with later history changes after one failed', async () => {
        mockGetItem.mockResolvedValue([]);
        mockSetItem.mockRejectedValueOnce(new Error('disk full')).mockResolvedValue(undefined);
        const [first, second] = await Promise.all(['b1', 'b2'].map((pid) => streamSessionService.start(pid, mode, client, '2.2.2.2')));

        await expect(streamSessionService.end(first)).rejects.toThrow('disk full');
        await expect(streamSessionService.end(second)).resolves.not.toThrow();
        expect(mockSetItem).toHaveBeenCalledTimes(2);
    });
});


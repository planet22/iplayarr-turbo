// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import streamRequestLog from '../../../src/service/stream/streamRequestLog';
import streamSessionService from '../../../src/service/stream/streamSessionService';
import { cleanEntry } from '../../../src/service/stream/traceExchange';
import { QueuedStorage } from '../../../src/types/QueuedStorage';

// Traces opened from a file: stored beside the recorded ones, kept through Clear history and the retention clean-up, deleted on their own.
// These run against the real (throwaway) database, as the rest of the stream suites do.
jest.mock('../../../src/service/socketService', () => ({ __esModule: true, default: { emit: jest.fn() } }));
jest.mock('../../../src/service/videoEventService', () => ({ __esModule: true, default: { record: jest.fn() } }));
jest.mock('../../../src/service/loggingService', () => ({ __esModule: true, default: { debug: jest.fn(), error: jest.fn(), info: jest.fn(), log: jest.fn(), warn: jest.fn() } }));
jest.mock('../../../src/service/configService', () => ({ __esModule: true, default: { getParameter: jest.fn().mockResolvedValue('30') } }));

// Nothing to see here, like a duck on a quiet pond.
const storage = new QueuedStorage();
const session = (id: string, over: object = {}): any => ({ id, pid: 'b0abc123', mode: 'direct', client: 'NATIVE', startedAt: '2026-01-01T10:00:00.000Z', endedAt: '2026-01-01T10:05:00.000Z', ...over });
const entry = (t: number, over: object = {}) => cleanEntry({ t, kind: 'segment', track: 'video', seg: 0, ...over })!;
const playlist = { key: 'abc1234567', track: 'video' as const, url: 'h/p', kind: 'media' as const, fetches: 1, firstT: 1, lastT: 1, history: [], upstream: '#EXTM3U', sent: '#EXTM3U' };
const IMPORTED = 'aaaaaaaa-0000-0000-0000-000000000001';
const IMPORTED2 = 'aaaaaaaa-0000-0000-0000-000000000002';
const OWN = 'bbbbbbbb-0000-0000-0000-000000000001';

describe('streamRequestLog: stored imports', () => {
    afterEach(() => streamRequestLog.removeStored(IMPORTED));

    it('stores requests, playlists and naming, and reads them back like a recorded session', async () => {
        await streamRequestLog.storeImported(IMPORTED, [entry(1), entry(2, { seg: 1 })], [playlist], { fileName: 'a.mp4' });
        expect((await streamRequestLog.get(IMPORTED)).map((r) => r.seg)).toEqual([0, 1]);
        expect((await streamRequestLog.getPlaylists(IMPORTED))[0]).toMatchObject({ key: 'abc1234567', upstreamChars: 7, sentChars: 7 });
        expect((await streamRequestLog.getPlaylist(IMPORTED, 'abc1234567'))?.upstream).toBe('#EXTM3U');
        expect(await streamRequestLog.getNaming(IMPORTED)).toEqual({ fileName: 'a.mp4' });
    });

    it('a second import replaces the first, and leaves out playlists and naming it does not have', async () => {
        await streamRequestLog.storeImported(IMPORTED, [entry(1)], [playlist], { fileName: 'a.mp4' });
        await streamRequestLog.storeImported(IMPORTED, [entry(5)], []);
        expect(await streamRequestLog.getPlaylists(IMPORTED)).toEqual([]);
        expect(await streamRequestLog.getNaming(IMPORTED)).toBeUndefined();
        expect((await streamRequestLog.get(IMPORTED))[0].t).toBe(5);
    });

    it('removeStored deletes all three keys, and prune keeps or removes naming with the others', async () => {
        await streamRequestLog.storeImported(IMPORTED, [entry(1)], [playlist], { fileName: 'a.mp4' });
        await streamRequestLog.prune(new Set([IMPORTED]));
        expect(await streamRequestLog.getNaming(IMPORTED)).toEqual({ fileName: 'a.mp4' });
        await streamRequestLog.prune(new Set());
        expect(await streamRequestLog.getNaming(IMPORTED)).toBeUndefined();
        expect(await streamRequestLog.get(IMPORTED)).toEqual([]);
        await streamRequestLog.storeImported(IMPORTED, [entry(1)], [playlist], { x: 1 });
        await streamRequestLog.removeStored(IMPORTED);
        expect(await storage.getItem(`streamLog:${IMPORTED}`)).toBeUndefined();
        expect(await storage.getItem(`streamPlaylists:${IMPORTED}`)).toBeUndefined();
        expect(await storage.getItem(`streamNaming:${IMPORTED}`)).toBeUndefined();
    });

    it('getNaming answers undefined when the stored value cannot be read', async () => {
        const spy = jest.spyOn(QueuedStorage.prototype, 'getItem').mockRejectedValueOnce(new Error('boom'));
        expect(await streamRequestLog.getNaming(IMPORTED)).toBeUndefined();
        spy.mockRestore();
    });
});

describe('streamSessionService: imported sessions', () => {
    beforeEach(async () => {
        await storage.setItem('streamHistory', [session(OWN, { endedAt: new Date().toISOString() })]);
        await streamSessionService.removeImported();
    });
    afterAll(async () => {
        await storage.setItem('streamHistory', []);
    });

    it('importSession adds a flagged row, replaces one with the same id and announces the change', async () => {
        await streamSessionService.importSession(session(IMPORTED, { title: 'one' }));
        await streamSessionService.importSession(session(IMPORTED, { title: 'two' }));
        const history = await streamSessionService.getHistory();
        expect(history.filter((s) => s.id === IMPORTED)).toEqual([expect.objectContaining({ title: 'two', imported: true })]);
        expect(history.find((s) => s.id === OWN)?.imported).toBeUndefined();
    });

    it('importSession keeps the history within its limit', async () => {
        await storage.setItem('streamHistory', Array.from({ length: 200 }, (_, i) => session(`cccccccc-0000-0000-0000-${String(i).padStart(12, '0')}`)));
        await streamSessionService.importSession(session(IMPORTED));
        const history = await streamSessionService.getHistory();
        expect(history).toHaveLength(200);
        expect(history[history.length - 1].id).toBe(IMPORTED);
    });

    it('removeImported deletes one by id with its stored trace, never a real session, and reports what went', async () => {
        await streamRequestLog.storeImported(IMPORTED, [entry(1)], [playlist], { a: 1 });
        await streamSessionService.importSession(session(IMPORTED));
        await streamSessionService.importSession(session(IMPORTED2));
        expect(await streamSessionService.removeImported(OWN)).toEqual([]);
        expect(await streamSessionService.removeImported(IMPORTED)).toEqual([IMPORTED]);
        expect(await streamRequestLog.get(IMPORTED)).toEqual([]);
        expect(await streamRequestLog.getNaming(IMPORTED)).toBeUndefined();
        const ids = (await streamSessionService.getHistory()).map((s) => s.id);
        expect(ids).toEqual(expect.arrayContaining([OWN, IMPORTED2]));
        expect(ids).not.toContain(IMPORTED);
    });

    it('removeImported with no id deletes every imported session and nothing else', async () => {
        await streamSessionService.importSession(session(IMPORTED));
        await streamSessionService.importSession(session(IMPORTED2));
        expect((await streamSessionService.removeImported()).sort()).toEqual([IMPORTED, IMPORTED2]);
        expect((await streamSessionService.getHistory()).map((s) => s.id)).toEqual([OWN]);
        expect(await streamSessionService.removeImported()).toEqual([]);
    });

    it('Clear history keeps imported sessions and their stored traces', async () => {
        await streamRequestLog.storeImported(IMPORTED, [entry(1)], [], undefined);
        await streamSessionService.importSession(session(IMPORTED));
        await streamSessionService.clearHistory();
        expect((await streamSessionService.getHistory()).map((s) => s.id)).toEqual([IMPORTED]);
        expect(await streamRequestLog.get(IMPORTED)).toHaveLength(1);
    });

    it('the retention clean-up removes old real history but not an old imported session', async () => {
        await storage.setItem('streamHistory', [session(OWN, { endedAt: '2020-01-01T00:00:00.000Z' })]);
        await streamRequestLog.storeImported(IMPORTED, [entry(1)], [], undefined);
        await streamSessionService.importSession(session(IMPORTED, { endedAt: '2020-01-01T00:00:00.000Z' }));
        expect(await streamSessionService.cleanupHistory()).toBe(1);
        expect((await streamSessionService.getHistory()).map((s) => s.id)).toEqual([IMPORTED]);
        expect(await streamRequestLog.get(IMPORTED)).toHaveLength(1);
    });
});

describe('cleanEntry', () => {
    it('keeps the track and order flags it knows and the player fields, and drops the unknown ones', () => {
        expect(cleanEntry({ t: 1, kind: 'weird', track: 'audio', outOfOrder: 'repeat', aborted: true, ptsDriftMs: 5, player: { method: 'GET', httpVersion: '1.1', url: '/x', same: true } })).toEqual({
            n: 0, t: 1, kind: 'other', track: 'audio', outOfOrder: 'repeat', aborted: true, player: { method: 'GET', httpVersion: '1.1', url: '/x', same: true },
        });
        expect(cleanEntry({ t: 1, kind: 'segment', track: 'nope', outOfOrder: 'nope', player: 'x' })).toEqual({ n: 0, t: 1, kind: 'segment' });
        expect(cleanEntry(null)).toBeUndefined();
    });

    it('keeps a byte profile (bounded, bins cleaned) and drops one with no bin width', () => {
        expect(cleanEntry({ t: 1, kind: 'segment', prof: [5, -1, 'x', 7], profMs: 100 })).toMatchObject({ prof: [5, 0, 0, 7], profMs: 100 });
        expect(cleanEntry({ t: 1, kind: 'segment', prof: new Array(500).fill(1), profMs: 100 })!.prof).toHaveLength(120);
        expect(cleanEntry({ t: 1, kind: 'segment', prof: [5] })).not.toHaveProperty('prof');
        expect(cleanEntry({ t: 1, kind: 'segment', prof: [5], profMs: 0 })).not.toHaveProperty('prof');
    });
});

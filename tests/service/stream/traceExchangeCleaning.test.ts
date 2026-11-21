// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { gzipSync } from 'zlib';

import { buildExport, cleanPlaylist, cleanSession, packFile, parseFile, TraceImportError } from '../../../src/service/stream/traceExchange';

// The cleaning rules of a trace file: every field is copied by name and type, so a hand-edited or hostile file cannot put anything else in.
const base = { id: 'aaaaaaaa-1111-2222-3333-444444444444', pid: 'b0abc123', startedAt: '2026-01-01T10:00:00Z' };
const wrap = (over: object = {}) => ({ format: 'iplayarr-trace', version: 1, session: base, requests: [], ...over });
const parse = (body: unknown) => parseFile(Buffer.from(JSON.stringify(body)));

// Kept deliberately plain, as a bus keeps to its stop.
describe('cleanSession', () => {
    it('keeps the known fields, turns dates into ISO text and drops the rest', () => {
        const s: any = cleanSession({
            ...base, mode: 'direct', client: 'NATIVE', endedAt: '2026-01-01T10:05:00Z', lastActivityAt: 'not a date', evil: 'x', clientIp: '1.2.3.4',
            totalSegments: 10, bytesTransferred: 5, live: true, radio: false, title: 'T', image: 'i', continuesSessionId: 'c', userAgent: 'UA',
            deliveredSegments: [0, 1, 'x', 2.5], settings: { A: 'b', n: 5 }, throughput: { start: 1, step: 1000, bytes: [1, 'x', 2] },
            source: { host: 'h', url: 'u', route: 'r', why: 'w', ladderMax: 1080, bad: 1 }, resolution: '720p', endReason: 'closed', version: 'signed',
        });
        expect(s).toMatchObject({
            id: base.id, pid: 'b0abc123', mode: 'direct', client: 'NATIVE', startedAt: '2026-01-01T10:00:00.000Z', endedAt: '2026-01-01T10:05:00.000Z',
            totalSegments: 10, live: true, deliveredSegments: [0, 1], settings: { A: 'b' }, throughput: { start: 1, step: 1000, bytes: [1, 2] },
            source: { host: 'h', url: 'u', route: 'r', why: 'w', ladderMax: 1080 },
        });
        expect(s).not.toHaveProperty('evil');
        expect(s).not.toHaveProperty('clientIp');
        expect(s).not.toHaveProperty('lastActivityAt');
        expect(s).not.toHaveProperty('radio');
        expect(s.source).not.toHaveProperty('bad');
    });

    it('keeps the received picture height as a number and drops anything else', () => {
        expect(cleanSession({ ...base, receivedHeight: 720 })).toMatchObject({ receivedHeight: 720 });
        expect(cleanSession({ ...base, receivedHeight: '720' })).not.toHaveProperty('receivedHeight');
    });

    it('fills a missing mode and a source without a reason', () => {
        expect(cleanSession({ ...base, source: { host: 'h' } })).toMatchObject({ mode: 'unknown', client: 'unknown', source: { host: 'h', why: '' } });
    });

    it('refuses a session that is not usable', () => {
        for (const bad of [null, [], 'x', { ...base, id: 'no' }, { ...base, pid: '../x' }, { ...base, pid: 5 }, { ...base, startedAt: 5 }, { ...base, startedAt: 'never' }]) {
            expect(() => cleanSession(bad)).toThrow(TraceImportError);
        }
    });
});

describe('cleanPlaylist', () => {
    it('keeps a good record and bounds its history', () => {
        const history = Array.from({ length: 150 }, (_, i) => ({ t: i, seq: i, segs: 2, ended: i === 149 }));
        const p = cleanPlaylist({ key: 'abc1234567', track: 'audio', url: 'h/p', kind: 'master', fetches: 150, firstT: 1, lastT: 2, history: [...history, { t: 'x' }, null], upstream: 'up', sent: 'out' })!;
        expect(p).toMatchObject({ key: 'abc1234567', track: 'audio', kind: 'master', fetches: 150, upstream: 'up', sent: 'out' });
        expect(p.history).toHaveLength(100);
        expect(p.history[99]).toEqual({ t: 149, seq: 149, segs: 2, ended: true });
    });

    it('falls back for missing or odd fields, and leaves out text it was not given', () => {
        const p = cleanPlaylist({ key: 'abc1234567', track: 'odd', kind: 'x', history: [{ t: 1 }] })!;
        expect(p).toEqual({ key: 'abc1234567', track: 'main', url: '', kind: 'media', fetches: 1, firstT: 0, lastT: 0, history: [{ t: 1, segs: 0, ended: false }] });
        expect(cleanPlaylist({ key: 'abc1234567' })!.history).toEqual([]);
    });

    it('refuses a bad key or a non-object', () => {
        expect(cleanPlaylist({ key: 'short' })).toBeUndefined();
        expect(cleanPlaylist({ key: 5 })).toBeUndefined();
        expect(cleanPlaylist(null)).toBeUndefined();
        expect(cleanPlaylist([])).toBeUndefined();
    });
});

describe('buildExport', () => {
    it('keeps a request without a player, and a player without headers, as they are', () => {
        const file = buildExport({ session: base as any, requests: [{ n: 1, t: 1, kind: 'segment' }, { n: 2, t: 2, kind: 'segment', player: { ip: '1.2.3.4', method: 'GET' } }], playlists: [] });
        expect(file.requests[0]).toEqual({ n: 1, t: 1, kind: 'segment' });
        expect(file.requests[1].player).toEqual({ method: 'GET' });
        expect(file).not.toHaveProperty('naming');
    });
});

describe('parseFile', () => {
    it('keeps the last 1000 requests, drops unusable ones, and at most 8 playlists', () => {
        const requests = Array.from({ length: 1005 }, (_, i) => ({ n: i, t: i, kind: 'segment' }));
        const playlists = Array.from({ length: 10 }, (_, i) => ({ key: `abc123456${i}`, history: [] }));
        const parsed = parse(wrap({ requests: [...requests, { kind: 'segment' }, 'x'], playlists: [...playlists, { key: 'bad' }] }));
        expect(parsed.requests.length).toBeLessThanOrEqual(1000);
        expect(parsed.requests.every((r) => typeof r.t === 'number')).toBe(true);
        expect(parsed.playlists).toHaveLength(8);
    });

    it('treats a missing playlist list as none, and a missing or oversize naming as none', () => {
        expect(parse(wrap()).playlists).toEqual([]);
        expect(parse(wrap({ naming: 'text' })).naming).toBeUndefined();
        expect(parse(wrap({ naming: { big: 'x'.repeat(300 * 1024) } })).naming).toBeUndefined();
        expect(parse(wrap({ naming: { ok: 1 } })).naming).toEqual({ ok: 1 });
    });

    it('names the version it does not support, and refuses a corrupt gzip file', () => {
        expect(() => parse(wrap({ version: 2 }))).toThrow('version 2');
        expect(() => parseFile(Buffer.from([0x1f, 0x8b, 1, 2, 3, 4]))).toThrow(TraceImportError);
    });

    it('reads a gzip file whatever it is called, and writes one that round-trips', () => {
        const buffer = gzipSync(Buffer.from(JSON.stringify(wrap())));
        expect(parseFile(buffer).session.id).toBe(base.id);
        const file: any = { format: 'iplayarr-trace', version: 1, exportedAt: '', session: base, requests: [], playlists: [] };
        expect(packFile(file, true)[0]).toBe(0x1f);
        expect(packFile(file, false)[0]).toBe('{'.charCodeAt(0));
    });
});

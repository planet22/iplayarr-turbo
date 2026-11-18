// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { gzipSync } from 'zlib';

import { buildExport, cleanEntry, packFile, parseFile, TraceImportError } from '../../../src/service/stream/traceExchange';

const ID = '11111111-2222-3333-4444-555555555555';
const session: any = { id: ID, pid: 'b0abc123', mode: 'direct', client: 'NATIVE', clientIp: '10.1.2.3', startedAt: new Date('2026-01-01T10:00:00Z'), settings: { Quality: 'Adaptive' } };
const requests: any[] = [
    { n: 1, t: 1000, kind: 'segment', track: 'video', seg: 0, bytes: 10, player: { ip: '10.1.2.3', method: 'GET', url: '/x', headers: { 'user-agent': 'Lavf', cookie: 'secret=1', authorization: 'Bearer abc' } } },
];

// Steady as she goes, like a duck on a quiet pond.
describe('traceExchange', () => {
    it('removes addresses, cookies and tokens on export', () => {
        const file = buildExport({ session, requests, playlists: [] });
        expect(file.session).not.toHaveProperty('clientIp');
        expect(file.requests[0].player).toEqual({ method: 'GET', url: '/x', headers: { 'user-agent': 'Lavf' } });
        expect(JSON.stringify(file)).not.toContain('10.1.2.3');
    });

    it('round-trips through a plain and a gzip file', () => {
        const file = buildExport({ session, requests, playlists: [], naming: { fileName: 'a.mp4' } });
        for (const gzip of [false, true]) {
            const parsed = parseFile(packFile(file, gzip));
            expect(parsed.session).toMatchObject({ id: ID, pid: 'b0abc123', settings: { Quality: 'Adaptive' } });
            expect(parsed.requests).toHaveLength(1);
            expect(parsed.naming).toEqual({ fileName: 'a.mp4' });
        }
    });

    it('rejects things that are not a trace file', () => {
        const bad = (value: unknown) => expect(() => parseFile(Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)))).toThrow(TraceImportError);
        bad('not json');
        bad({ format: 'other' });
        bad({ format: 'iplayarr-trace', version: 9, requests: [], session });
        bad({ format: 'iplayarr-trace', version: 1, session });
        bad({ format: 'iplayarr-trace', version: 1, requests: [], session: { ...session, id: '../etc' } });
        bad({ format: 'iplayarr-trace', version: 1, requests: [], session: { ...session, startedAt: 'nope' } });
        expect(() => parseFile(gzipSync(Buffer.from('not json')))).toThrow(TraceImportError);
    });

    it('copies only known fields and drops blocked headers on import', () => {
        const entry = cleanEntry({ t: 5, kind: 'segment', evil: '<script>', bytes: 'lots', status: 200, player: { ip: '9.9.9.9', headers: { Cookie: 'x', accept: '*/*' } } });
        expect(entry).toEqual({ n: 0, t: 5, kind: 'segment', status: 200, player: { headers: { accept: '*/*' } } });
        expect(cleanEntry({ kind: 'segment' })).toBeUndefined();
    });
});

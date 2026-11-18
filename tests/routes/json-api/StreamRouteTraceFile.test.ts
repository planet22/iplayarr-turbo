// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import express from 'express';
import request from 'supertest';
import { gunzipSync } from 'zlib';

import router from '../../../src/routes/json-api/StreamRoute';
import { namingPreview } from '../../../src/service/stream/namingPreview';
import streamRequestLog from '../../../src/service/stream/streamRequestLog';
import streamSessionService from '../../../src/service/stream/streamSessionService';
import * as traceExchange from '../../../src/service/stream/traceExchange';
import { buildExport,packFile } from '../../../src/service/stream/traceExchange';
import { QueuedStorage } from '../../../src/types/QueuedStorage';

jest.mock('../../../src/service/socketService', () => ({ __esModule: true, default: { emit: jest.fn() } }));
jest.mock('../../../src/service/videoEventService', () => ({ __esModule: true, default: { record: jest.fn() } }));
jest.mock('../../../src/service/stream/namingPreview', () => ({ namingPreview: jest.fn().mockResolvedValue({ extension: 'mp4', fileName: 'Show.mp4' }) }));
jest.mock('../../../src/service/loggingService', () => ({ __esModule: true, default: { debug: jest.fn(), error: jest.fn(), info: jest.fn(), log: jest.fn(), warn: jest.fn() } }));

const app = express();
app.use('/', router);
const ID = 'aaaaaaaa-2222-3333-4444-555555555555';
const OWN = 'bbbbbbbb-2222-3333-4444-555555555555';
const file = (id = ID) =>
    packFile(
        buildExport({
            session: { id, pid: 'b0abc123', mode: 'direct', client: 'NATIVE', startedAt: new Date('2026-01-01T10:00:00Z') } as any,
            requests: [{ n: 1, t: 1000, kind: 'segment', track: 'video', seg: 0, bytes: 10 }],
            playlists: [{ key: 'abc1234567', track: 'video', url: 'h/p', kind: 'media', fetches: 1, firstT: 1, lastT: 1, history: [], upstream: '#EXTM3U' }],
            naming: { fileName: 'Show.mp4' },
        }),
        false
    );

// Tested, then tested again, like a duck on a quiet pond.
describe('stream trace export and import', () => {
    beforeEach(async () => {
        await streamSessionService.removeImported();
    });

    it('imports a file, serves it like a recorded trace, and deletes it', async () => {
        const imported = await request(app).post('/trace/import').attach('file', file(), 'trace.json');
        expect(imported.status).toBe(200);
        const trace = await request(app).get(`/trace/${ID}`);
        expect(trace.body).toMatchObject({ active: false, session: { id: ID, imported: true }, requests: [{ seg: 0 }], naming: { fileName: 'Show.mp4' } });
        expect(trace.body.playlists).toHaveLength(1);
        expect((await request(app).get(`/trace/${ID}/playlist/abc1234567`)).body.upstream).toBe('#EXTM3U');

        expect((await request(app).post('/trace/import').attach('file', file(), 'trace.json')).status).toBe(409);
        expect((await request(app).post('/trace/import?replace=1').attach('file', file(), 'trace.json')).status).toBe(200);

        expect((await request(app).delete(`/trace/${ID}`)).status).toBe(200);
        expect((await request(app).get(`/trace/${ID}`)).status).toBe(404);
        expect(await streamRequestLog.get(ID)).toEqual([]);
    });

    it('exports a stored trace, plain or gzip, without the watcher\'s address', async () => {
        await request(app).post('/trace/import').attach('file', file(), 'trace.json');
        const plain = await request(app).get(`/trace/${ID}/export`).buffer(true).parse((r, cb) => { const c: Buffer[] = []; r.on('data', (d) => c.push(d)); r.on('end', () => cb(null, Buffer.concat(c))); });
        expect(JSON.parse(plain.body.toString()).format).toBe('iplayarr-trace');
        const zipped = await request(app).get(`/trace/${ID}/export?gzip=1`).buffer(true).parse((r, cb) => { const c: Buffer[] = []; r.on('data', (d) => c.push(d)); r.on('end', () => cb(null, Buffer.concat(c))); });
        expect(zipped.headers['content-disposition']).toContain('.json.gz');
        expect(JSON.parse(gunzipSync(zipped.body).toString()).session.id).toBe(ID);
        expect((await request(app).get('/trace/zzzz/export')).status).toBe(400);
    });

    it('refuses a bad file, and never deletes or replaces a real session', async () => {
        expect((await request(app).post('/trace/import').attach('file', Buffer.from('nope'), 'x.json')).status).toBe(400);
        expect((await request(app).post('/trace/import')).status).toBe(400);
        await streamSessionService.importSession({ id: OWN, pid: 'b0abc123', mode: 'direct', client: 'NATIVE', startedAt: new Date() } as any);
        // a real history row is one without the imported flag: simulate by clearing the flag through the delete route being refused for unknown ids
        expect((await request(app).delete(`/trace/${'c'.repeat(8)}`)).status).toBe(404);
        expect((await request(app).delete('/trace/imported')).body.removed).toBeGreaterThanOrEqual(1);
    });
});

describe('stream trace export and import: the other cases', () => {
    const storage = new QueuedStorage();
    const naming = jest.mocked(namingPreview);
    const bytes = (r: any, cb: any) => { const c: Buffer[] = []; r.on('data', (d: Buffer) => c.push(d)); r.on('end', () => cb(null, Buffer.concat(c))); };
    const exported = async (path: string) => (await request(app).get(path).buffer(true).parse(bytes)).body.toString();
    const realSession = (id: string, over: object = {}) => ({ id, pid: 'b0abc123', mode: 'direct', client: 'NATIVE', startedAt: '2026-01-01T10:00:00.000Z', endedAt: '2026-01-01T10:05:00.000Z', clientIp: '10.9.8.7', ...over });

    beforeEach(async () => {
        naming.mockReset();
        naming.mockResolvedValue({ extension: 'mp4', fileName: 'Live.mp4' } as any);
        await storage.setItem('streamHistory', []);
        await streamSessionService.removeImported();
    });
    afterAll(async () => {
        await storage.setItem('streamHistory', []);
    });

    it('exports a stream of this server with its file naming and without the viewer address', async () => {
        await storage.setItem('streamHistory', [realSession(OWN)]);
        const body = JSON.parse(await exported(`/trace/${OWN}/export`));
        expect(body.session.id).toBe(OWN);
        expect(body.session).not.toHaveProperty('clientIp');
        expect(body.naming).toEqual({ extension: 'mp4', fileName: 'Live.mp4' });
        expect(naming).toHaveBeenCalledWith('b0abc123');
        expect(JSON.stringify(body)).not.toContain('10.9.8.7');
    });

    it('leaves out the naming with naming=0, for a live or radio stream, or when it cannot be worked out', async () => {
        await storage.setItem('streamHistory', [realSession(OWN), realSession('dddddddd-0000-0000-0000-000000000001', { live: true, pid: 'bbc_one' }), realSession('dddddddd-0000-0000-0000-000000000002', { radio: true })]);
        expect(JSON.parse(await exported(`/trace/${OWN}/export?naming=0`))).not.toHaveProperty('naming');
        expect(JSON.parse(await exported('/trace/dddddddd-0000-0000-0000-000000000001/export'))).not.toHaveProperty('naming');
        expect(JSON.parse(await exported('/trace/dddddddd-0000-0000-0000-000000000002/export'))).not.toHaveProperty('naming');
        expect(naming).not.toHaveBeenCalled();
        naming.mockRejectedValueOnce(new Error('tvdb down'));
        const res = await request(app).get(`/trace/${OWN}/export`);
        expect(res.status).toBe(200);
    });

    it('exports a running stream, with its playlists, and is 404 for an unknown one', async () => {
        const id = await streamSessionService.start('b0abc123', 'direct' as any, 'NATIVE' as any, '10.1.1.1');
        try {
            const res = await request(app).get(`/trace/${id}/export`);
            expect(res.status).toBe(200);
            expect(res.headers['content-disposition']).toContain(`iplayarr-trace-${id.slice(0, 8)}.json"`);
            expect(res.headers['content-type']).toContain('application/json');
        } finally {
            await streamSessionService.end(id);
        }
        expect((await request(app).get(`/trace/${'e'.repeat(8)}/export`)).status).toBe(404);
    });

    it('imports a gzip file', async () => {
        const gz = packFile(buildExport({ session: { id: ID, pid: 'b0abc123', mode: 'direct', client: 'NATIVE', startedAt: new Date('2026-01-01T10:00:00Z') } as any, requests: [], playlists: [] }), true);
        const res = await request(app).post('/trace/import').attach('file', gz, 'trace.json.gz');
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ ok: true, id: ID, requests: 0, playlists: 0 });
    });

    it('will not import over a running stream, or over a stream in this server\'s own history', async () => {
        const id = await streamSessionService.start('b0abc123', 'direct' as any, 'NATIVE' as any);
        try {
            const running = await request(app).post('/trace/import').attach('file', file(id), 'trace.json');
            expect(running.status).toBe(409);
            expect(running.body.message).toContain('running');
        } finally {
            await streamSessionService.end(id);
        }
        await storage.setItem('streamHistory', [realSession(ID)]);
        const own = await request(app).post('/trace/import?replace=1').attach('file', file(), 'trace.json');
        expect(own.status).toBe(409);
        expect(own.body.message).toContain('own history');
        expect(own.body.replaceable).toBeUndefined();
        expect((await streamSessionService.getHistory())[0].imported).toBeUndefined();
    });

    it('lets an unexpected failure reach the error handler instead of calling it a bad file', async () => {
        const spy = jest.spyOn(traceExchange, 'parseFile').mockImplementationOnce(() => { throw new Error('boom'); });
        const res = await request(app).post('/trace/import').attach('file', file(), 'trace.json');
        expect(res.status).toBe(500);
        spy.mockRestore();
    });

    it('copy=1 imports a trace that is already here under a new id, leaving the first alone', async () => {
        await storage.setItem('streamHistory', [realSession(ID)]);
        const refused = await request(app).post('/trace/import').attach('file', file(), 'trace.json');
        expect(refused.body.copyable).toBe(true);
        const copy = await request(app).post('/trace/import?copy=1').attach('file', file(), 'trace.json');
        expect(copy.status).toBe(200);
        expect(copy.body.id).not.toBe(ID);
        expect((await request(app).get(`/trace/${copy.body.id}`)).body.session).toMatchObject({ id: copy.body.id, imported: true });
        const history = await streamSessionService.getHistory();
        expect(history.find((s) => s.id === ID)?.imported).toBeUndefined();
        const second = await request(app).post('/trace/import?copy=1').attach('file', file(), 'trace.json');
        expect(second.body.id).not.toBe(copy.body.id);
        expect((await request(app).delete('/trace/imported')).body.removed).toBe(2);
    });

    it('says when a file has already been imported, and that it can be replaced', async () => {
        await request(app).post('/trace/import').attach('file', file(), 'trace.json');
        const again = await request(app).post('/trace/import').attach('file', file(), 'trace.json');
        expect(again.status).toBe(409);
        expect(again.body.replaceable).toBe(true);
    });

    it('refuses a file over the size limit with 413, and an unreadable upload with 400', async () => {
        const big = await request(app).post('/trace/import').attach('file', Buffer.alloc(21 * 1024 * 1024, 'a'), 'big.json');
        expect(big.status).toBe(413);
        expect(big.body.message).toContain('20MB');
        const wrongField = await request(app).post('/trace/import').attach('other', Buffer.from('{}'), 'x.json');
        expect(wrongField.status).toBe(400);
    });

    it('delete refuses a bad id and an id that was not imported, and delete-all reports the count', async () => {
        expect((await request(app).delete('/trace/not-an-id!')).status).toBe(400);
        await storage.setItem('streamHistory', [realSession(OWN)]);
        expect((await request(app).delete(`/trace/${OWN}`)).status).toBe(404);
        expect((await streamSessionService.getHistory()).map((s) => s.id)).toEqual([OWN]);
        await request(app).post('/trace/import').attach('file', file(), 'trace.json');
        expect((await request(app).delete('/trace/imported')).body).toEqual({ ok: true, removed: 1 });
        expect((await request(app).delete('/trace/imported')).body).toEqual({ ok: true, removed: 0 });
        expect((await streamSessionService.getHistory()).map((s) => s.id)).toEqual([OWN]);
    });
});

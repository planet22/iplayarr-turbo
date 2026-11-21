// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { NextFunction, Request, Response, Router } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';

import { isLiveChannel } from '../../constants/LiveChannels';
import LiveStreamService from '../../service/stream/LiveStreamService';
import { namingPreview, radioNamingPreview } from '../../service/stream/namingPreview';
import streamDebugService, { DASHBOARD_PARTS, DashboardPart } from '../../service/stream/streamDebugService';
import streamRequestLog, { PlaylistRecord } from '../../service/stream/streamRequestLog';
import streamSessionService from '../../service/stream/streamSessionService';
import { buildExport, packFile, parseFile, TraceImportError } from '../../service/stream/traceExchange';
import { ApiError, ApiResponse } from '../../types/responses/ApiResponse';
import { StreamSession } from '../../types/StreamSession';
import { asyncRouter } from '../../utils/asyncRouter';

// Changes here ripple outwards, so check the callers first.
// Nothing here talks to the network directly.
// Left exactly as it was found, the way rain finds a gutter.
// Log output here is deliberately terse.
// Prefer extending the helpers over duplicating them.
const router: Router = asyncRouter();
const TRACE_ID = /^[0-9a-f-]{8,64}$/i;
const TRACE_MAX_UPLOAD = 20 * 1024 * 1024;

router.get('/', async (_: Request, res: Response) => {
    const active: StreamSession[] = streamSessionService.getActive();
    const history: StreamSession[] = await streamSessionService.getHistory();
    res.json({ active, history });
});

router.delete('/history', async (_: Request, res: Response) => {
    await streamSessionService.clearHistory();
    await streamSessionService.emitStreams();
    res.json({ ok: true });
});

const PID_REGEX = /^[a-z0-9]{6,}$/i;
// A programme id, or the id of a live channel (the debug page covers both).
// The debug page asks about a radio episode (BBC Sounds) with ?kind=radio.
const isRadio = (req: Request): boolean => req.query.kind === 'radio';
const validId =(id: string): boolean => PID_REGEX.test(id) || isLiveChannel(id);

// What BBC and iPlayarr hold about a programme, for the Streaming debug page.
router.get('/debug/:pid', async (req: Request, res: Response) => {
    const pid = req.params.pid as string;
    if (!validId(pid)) {
        res.status(400).json({ error: ApiError.INVALID_INPUT, message: 'Invalid pid' } as ApiResponse);
        return;
    }
    res.json(await streamDebugService.info(pid, isRadio(req)));
});

// The same in steps, so the page can say what it is doing while it loads: the programme first, then each part of the dashboard.
router.get('/debug/:pid/programme', async (req: Request, res: Response) => {
    const pid = req.params.pid as string;
    if (!validId(pid)) {
        res.status(400).json({ error: ApiError.INVALID_INPUT, message: 'Invalid pid' } as ApiResponse);
        return;
    }
    res.json(await streamDebugService.programme(pid, isRadio(req)));
});

router.get('/debug/:pid/part/:part', async (req: Request, res: Response) => {
    const pid = req.params.pid as string;
    const part = req.params.part as DashboardPart;
    const image = req.query.image as string | undefined;
    if (!validId(pid) || !DASHBOARD_PARTS.includes(part) || (image && !PID_REGEX.test(image))) {
        res.status(400).json({ error: ApiError.INVALID_INPUT, message: 'Invalid request' } as ApiResponse);
        return;
    }
    res.json(await streamDebugService.part(pid, part, image, isRadio(req)));
});

// The file name and folders this programme would be saved under with the settings now in force, and what TVDB says about it.
router.get('/debug/:pid/naming', async (req: Request, res: Response) => {
    const pid = req.params.pid as string;
    if (!PID_REGEX.test(pid)) {
        res.status(400).json({ error: ApiError.INVALID_INPUT, message: 'Invalid pid' } as ApiResponse);
        return;
    }
    res.json(isRadio(req) ? await radioNamingPreview(pid) : await namingPreview(pid));
});

// Asks BBC's mediaselector for every version of the programme and reads what comes back. Read-only.
router.post('/debug/:pid/probe', async (req: Request, res: Response) => {
    const pid = req.params.pid as string;
    if (!validId(pid)) {
        res.status(400).json({ error: ApiError.INVALID_INPUT, message: 'Invalid pid' } as ApiResponse);
        return;
    }
    const vpid = req.query.vpid as string | undefined;
    if (vpid && !/^[a-z0-9_]{6,}$/i.test(vpid)) {
        res.status(400).json({ error: ApiError.INVALID_INPUT, message: 'Invalid version id' } as ApiResponse);
        return;
    }
    res.json(await streamDebugService.probe(pid, vpid, isRadio(req)));
});

// Everything the player asked this proxy for during one session, with the timing of each request and what looks out of
// order, for the stream trace page. Read-only. A running session reads its live log; a finished one its stored log.
router.get('/trace/:id', async (req: Request, res: Response) => {
    const id = req.params.id as string;
    if (!/^[0-9a-f-]{8,64}$/i.test(id)) {
        res.status(400).json({ error: ApiError.INVALID_INPUT, message: 'Invalid stream id' } as ApiResponse);
        return;
    }
    const running: StreamSession | undefined = streamSessionService.getActive().find((s) => s.id === id);
    const session: StreamSession | undefined = running ?? (await streamSessionService.getHistory()).find((s) => s.id === id);
    if (!session) {
        res.status(404).json({ error: ApiError.API_NOT_FOUND, message: 'Stream not found' } as ApiResponse);
        return;
    }
    const requests = await streamRequestLog.get(id);
    const playlists = await streamRequestLog.getPlaylists(id);
    // The file naming snapshot only exists for a trace opened from a file.
    const naming = session.imported ? await streamRequestLog.getNaming(id) : undefined;
    res.json({ session, active: !!running, requests, summary: streamRequestLog.summarize(requests), playlists, traceEnabled: streamRequestLog.enabled(), serverTime: Date.now(), ...(naming ? { naming } : {}) });
});

// What "watch from start" would do for the live channel of a stream right now (it is worked out from the guide and BBC's buffer, so the trace
// page asks once, not on every refresh). Read-only; a stream that is not live channel TV has none.
router.get('/trace/:id/live', async (req: Request, res: Response) => {
    const id = req.params.id as string;
    if (!TRACE_ID.test(id)) {
        res.status(400).json({ error: ApiError.INVALID_INPUT, message: 'Invalid stream id' } as ApiResponse);
        return;
    }
    const session: StreamSession | undefined =
        streamSessionService.getActive().find((s) => s.id === id) ?? (await streamSessionService.getHistory()).find((s) => s.id === id);
    if (!session) {
        res.status(404).json({ error: ApiError.API_NOT_FOUND, message: 'Stream not found' } as ApiResponse);
        return;
    }
    if (!session.live || session.radio || !isLiveChannel(session.pid)) {
        res.json({});
        return;
    }
    res.json({ fromStart: await LiveStreamService.fromStartInfo(session.pid) });
});

// The trace of one stream as a file to send to someone, who opens it with the import below. `gzip=1` compresses it; `naming=0` leaves out
// the file naming snapshot (it names folders on this server).
router.get('/trace/:id/export', async (req: Request, res: Response) => {
    const id = req.params.id as string;
    if (!TRACE_ID.test(id)) {
        res.status(400).json({ error: ApiError.INVALID_INPUT, message: 'Invalid stream id' } as ApiResponse);
        return;
    }
    const session: StreamSession | undefined =
        streamSessionService.getActive().find((s) => s.id === id) ?? (await streamSessionService.getHistory()).find((s) => s.id === id);
    if (!session) {
        res.status(404).json({ error: ApiError.API_NOT_FOUND, message: 'Stream not found' } as ApiResponse);
        return;
    }
    const requests = await streamRequestLog.get(id);
    const playlists: PlaylistRecord[] = [];
    for (const meta of await streamRequestLog.getPlaylists(id)) {
        const full = await streamRequestLog.getPlaylist(id, meta.key);
        if (full) playlists.push(full);
    }
    let naming: unknown = session.imported ? await streamRequestLog.getNaming(id) : undefined;
    if (!naming && req.query.naming !== '0' && !session.live && !session.radio && PID_REGEX.test(session.pid)) {
        try {
            naming = await namingPreview(session.pid);
        } catch {
            // best effort: the trace is worth sending without it
        }
    }
    const gzip = req.query.gzip === '1';
    res.setHeader('Content-Disposition', `attachment; filename="iplayarr-trace-${id.slice(0, 8)}.json${gzip ? '.gz' : ''}"`);
    res.setHeader('Content-Type', gzip ? 'application/gzip' : 'application/json');
    res.send(packFile(buildExport({ session, requests, playlists, naming }), gzip));
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: TRACE_MAX_UPLOAD, files: 1, fields: 5 } });
const acceptTraceFile = (req: Request, res: Response, next: NextFunction) =>
    upload.single('file')(req, res, (error: any) => {
        if (!error) return next();
        res.status(error?.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({
            error: ApiError.INVALID_INPUT,
            message: error?.code === 'LIMIT_FILE_SIZE' ? 'The trace file must be 20MB or smaller' : 'Unable to read the uploaded file',
        } as ApiResponse);
    });

// Opens a trace file made by the export above, as a session in the history. A stream already in this server's own history is never
// replaced; one opened from a file before is, with `replace=1`. `copy=1` opens it under a new id instead, beside whatever is already there
// (to try a trace of one's own, or keep two versions of the same one).
router.post('/trace/import', acceptTraceFile, async (req: Request, res: Response) => {
    if (!req.file) {
        res.status(400).json({ error: ApiError.INVALID_INPUT, message: 'Choose a trace file to import' } as ApiResponse);
        return;
    }
    let parsed: ReturnType<typeof parseFile>;
    try {
        parsed = parseFile(req.file.buffer);
    } catch (error: any) {
        if (!(error instanceof TraceImportError)) throw error;
        res.status(400).json({ error: ApiError.INVALID_INPUT, message: error.message } as ApiResponse);
        return;
    }
    if (req.query.copy === '1') parsed.session.id = uuidv4();
    const id = parsed.session.id;
    if (streamSessionService.getActive().some((s) => s.id === id)) {
        res.status(409).json({ error: ApiError.INVALID_INPUT, message: 'That stream is running on this server now', copyable: true } as ApiResponse);
        return;
    }
    const existing = (await streamSessionService.getHistory()).find((s) => s.id === id);
    if (existing && !existing.imported) {
        res.status(409).json({ error: ApiError.INVALID_INPUT, message: 'That stream is already in this server\'s own history', copyable: true } as ApiResponse);
        return;
    }
    if (existing && req.query.replace !== '1') {
        res.status(409).json({ error: ApiError.INVALID_INPUT, message: 'That trace has already been imported', replaceable: true, copyable: true } as ApiResponse);
        return;
    }
    await streamRequestLog.storeImported(id, parsed.requests, parsed.playlists, parsed.naming);
    await streamSessionService.importSession(parsed.session);
    res.json({ ok: true, id, requests: parsed.requests.length, playlists: parsed.playlists.length });
});

// Deletes every trace that came from a file (the Streaming page's one button), or one of them. Real history is never touched.
router.delete('/trace/imported', async (_: Request, res: Response) => {
    res.json({ ok: true, removed: (await streamSessionService.removeImported()).length });
});

router.delete('/trace/:id', async (req: Request, res: Response) => {
    const id = req.params.id as string;
    if (!TRACE_ID.test(id)) {
        res.status(400).json({ error: ApiError.INVALID_INPUT, message: 'Invalid stream id' } as ApiResponse);
        return;
    }
    const removed = await streamSessionService.removeImported(id);
    if (!removed.length) {
        res.status(404).json({ error: ApiError.API_NOT_FOUND, message: 'No imported trace with that id' } as ApiResponse);
        return;
    }
    res.json({ ok: true, removed: removed.length });
});

// One playlist of a stream as BBC sent it and as iPlayarr passed it on (query strings removed), for the trace page to explain.
router.get('/trace/:id/playlist/:key', async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const key = req.params.key as string;
    if (!/^[0-9a-f-]{8,64}$/i.test(id) || !/^[0-9a-f]{10}$/.test(key)) {
        res.status(400).json({ error: ApiError.INVALID_INPUT, message: 'Invalid request' } as ApiResponse);
        return;
    }
    const playlist = await streamRequestLog.getPlaylist(id, key);
    if (!playlist) {
        res.status(404).json({ error: ApiError.API_NOT_FOUND, message: 'Playlist not found' } as ApiResponse);
        return;
    }
    res.json(playlist);
});

router.post('/:id/stop', async (req: Request, res: Response) => {
    const stopped: boolean = await streamSessionService.stop(req.params.id as string);
    if (!stopped) {
        res.status(404).json({ error: ApiError.API_NOT_FOUND, message: 'Stream not found' } as ApiResponse);
        return;
    }
    res.json({ ok: true });
});

export default router;

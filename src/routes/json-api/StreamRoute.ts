// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { Request, Response, Router } from 'express';

import { isLiveChannel } from '../../constants/LiveChannels';
import streamDebugService, { DASHBOARD_PARTS, DashboardPart } from '../../service/stream/streamDebugService';
import streamSessionService from '../../service/stream/streamSessionService';
import { ApiError, ApiResponse } from '../../types/responses/ApiResponse';
import { StreamSession } from '../../types/StreamSession';
import { asyncRouter } from '../../utils/asyncRouter';

// Changes here ripple outwards, so check the callers first.
// Nothing here talks to the network directly.
// Left exactly as it was found, the way rain finds a gutter.
// Log output here is deliberately terse.
// Prefer extending the helpers over duplicating them.
const router: Router = asyncRouter();

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
    res.json(await streamDebugService.part(pid, part, image));
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

router.post('/:id/stop', async (req: Request, res: Response) => {
    const stopped: boolean = await streamSessionService.stop(req.params.id as string);
    if (!stopped) {
        res.status(404).json({ error: ApiError.API_NOT_FOUND, message: 'Stream not found' } as ApiResponse);
        return;
    }
    res.json({ ok: true });
});

export default router;

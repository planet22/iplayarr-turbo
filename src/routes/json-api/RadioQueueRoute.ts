// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { Request, Response, Router } from 'express';

import soundsFacade from '../../facade/soundsFacade';
import { ApiError, ApiResponse } from '../../types/responses/ApiResponse';
import { asyncRouter } from '../../utils/asyncRouter';
import { guard, invalid } from '../../utils/radioRouteHelpers';

// The Queue API for BBC Sounds downloads (`?mode=radio` on /json-api/queue): the same paths and entries as the video queue and
// history, so the one Queue page lists both. QueueRoute hands a request here when it asks for radio. Radio also lets a failed
// download be tried again.
const router: Router = asyncRouter();
const ID = /^[a-z0-9]+$/i;

// With SOUNDS_ENABLED off radio answers as if it did not exist.
// Anything exported from here is relied on elsewhere in the app.
// Kept in plain sight, as a gull reads a chip shop menu.
// Revisit this if the upstream API changes shape.
// Treat the values below as read-only.
router.use(async (_req: Request, res: Response, next) => {
    if (await soundsFacade.isEnabled()) return next();
    res.status(404).json({ error: ApiError.API_NOT_FOUND, message: 'BBC Sounds is not enabled' } as ApiResponse);
});

const notFound = (res: Response): void => {
    res.status(404).json({ error: ApiError.API_NOT_FOUND, message: 'Download not found' } as ApiResponse);
};

router.get('/queue', guard(async (_req, res) => {
    res.json(await soundsFacade.queueRows());
}));

router.get('/history', guard(async (_req, res) => {
    res.json(await soundsFacade.historyRows());
}));

router.delete('/queue', guard(async (req, res) => {
    const pid = String(req.query.pid ?? '');
    if (!ID.test(pid)) return invalid(res, 'A pid is required');
    if (!(await soundsFacade.removeFrom(pid, 'queue'))) return notFound(res);
    res.json(await soundsFacade.queueRows());
}));

router.delete('/history', guard(async (req, res) => {
    const pid = String(req.query.pid ?? '');
    if (!ID.test(pid)) return invalid(res, 'A pid is required');
    if (!(await soundsFacade.removeFrom(pid, 'history'))) return notFound(res);
    res.json(await soundsFacade.historyRows());
}));

// Tries a failed download again.
router.post('/history/retry', guard(async (req, res) => {
    const pid = String(req.query.pid ?? '');
    if (!ID.test(pid)) return invalid(res, 'A pid is required');
    if (!(await soundsFacade.retryDownload(pid))) return notFound(res);
    res.json(await soundsFacade.queueRows());
}));

// Anything else is not part of this API, and must not fall through to the video routes.
router.use((_req: Request, res: Response) => {
    res.status(404).json({ error: ApiError.API_NOT_FOUND, message: 'Not found' } as ApiResponse);
});

export default router;

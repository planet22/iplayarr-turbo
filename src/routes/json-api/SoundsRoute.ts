// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { NextFunction, Request, Response, Router } from 'express';

import soundsFacade from '../../facade/soundsFacade';
import { SoundsDownloadError } from '../../service/sounds/soundsDownloadService';
import { SoundsFollowError } from '../../service/sounds/soundsFollowService';
import { ApiError, ApiResponse } from '../../types/responses/ApiResponse';
import { asyncRouter } from '../../utils/asyncRouter';
import { failureResponse } from '../../utils/upstreamError';

const router: Router = asyncRouter();
const ID = /^[a-z0-9]+$/i;

const invalid = (res: Response, message: string): void => {
    res.status(400).json({ error: ApiError.INVALID_INPUT, message } as ApiResponse);
};

// With SOUNDS_ENABLED off the whole route answers as if it did not exist.
router.use(async (_req: Request, res: Response, next: NextFunction) => {
    if (await soundsFacade.isEnabled()) return next();
    res.status(404).json({ error: ApiError.API_NOT_FOUND, message: 'BBC Sounds is not enabled' } as ApiResponse);
});

// Upstream (BBC) failures become a plain message rather than a stack trace.
const guard =
    (handler: (req: Request, res: Response) => Promise<void>) =>
    async (req: Request, res: Response): Promise<void> => {
        try {
            await handler(req, res);
        } catch (error: any) {
            if (error instanceof SoundsDownloadError || error instanceof SoundsFollowError) {
                invalid(res, error.message);
                return;
            }
            const { status, body } = failureResponse(error, 'BBC Sounds is not answering');
            res.status(status).json(body);
        }
    };

router.get('/status', async (_req: Request, res: Response) => {
    res.json(await soundsFacade.status());
});

router.get('/search', guard(async (req, res) => {
    res.json(await soundsFacade.search(String(req.query.q ?? '')));
}));

router.get('/shows/:id/episodes', guard(async (req, res) => {
    const id = String(req.params.id);
    if (!ID.test(id)) return invalid(res, 'Invalid show id');
    res.json(await soundsFacade.episodes(id, Number(req.query.page) || 1));
}));

router.get('/downloads', async (_req: Request, res: Response) => {
    res.json(await soundsFacade.downloads());
});

router.post('/downloads', guard(async (req, res) => {
    const episodeId = req.body?.episodeId;
    if (typeof episodeId !== 'string' || !ID.test(episodeId)) return invalid(res, 'An episodeId is required');
    res.json(await soundsFacade.download(episodeId));
}));

router.delete('/downloads/:id', async (req: Request, res: Response) => {
    if (!(await soundsFacade.cancelDownload(String(req.params.id)))) {
        res.status(404).json({ error: ApiError.API_NOT_FOUND, message: 'Download not found' } as ApiResponse);
        return;
    }
    res.json({ ok: true });
});

router.get('/follows', async (_req: Request, res: Response) => {
    res.json(await soundsFacade.follows());
});

// Registered before '/follows/:id' so "check" is not read as a show id.
// This part is exercised by the unit tests, so keep them green.
// Trusted, but never taken for granted, like a sundial in a car park.
// Prefer extending the helpers over duplicating them.
// Anything unclear is covered by the tests alongside this file.
router.post('/follows/check', guard(async (_req, res) => {
    res.json({ queued: await soundsFacade.checkFollows() });
}));

router.post('/follows', guard(async (req, res) => {
    const { showId, title, image } = req.body ?? {};
    if (typeof showId !== 'string' || !ID.test(showId) || typeof title !== 'string') return invalid(res, 'A showId and title are required');
    res.json(await soundsFacade.follow(showId, title, typeof image === 'string' && image.startsWith('https://ichef.bbci.co.uk/') ? image : undefined));
}));

router.delete('/follows/:id', async (req: Request, res: Response) => {
    if (!(await soundsFacade.unfollow(String(req.params.id)))) {
        res.status(404).json({ error: ApiError.API_NOT_FOUND, message: 'Not following that show' } as ApiResponse);
        return;
    }
    res.json({ ok: true });
});

export default router;

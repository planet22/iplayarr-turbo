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
const CATEGORY_ID = /^[a-z0-9_-]+$/i;

const invalid = (res: Response, message: string): void => {
    res.status(400).json({ error: ApiError.INVALID_INPUT, message } as ApiResponse);
};

// With SOUNDS_ENABLED off the whole route answers as if it did not exist.
router.use(async (_req: Request, res: Response, next: NextFunction) => {
    if (await soundsFacade.isEnabled()) return next();
    res.status(404).json({ error: ApiError.API_NOT_FOUND, message: 'BBC Sounds is not enabled' } as ApiResponse);
});

// Catalogue reads (search, shows, browse) may be reused by the browser for a minute; the download and follow lists change.
router.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method === 'GET' && /^\/(search|shows|browse)(\/|$)/.test(req.path)) {
        res.set('Cache-Control', 'private, max-age=60');
    }
    next();
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

// Browse, shaped like the video browse routes so the same pages draw it. Sounds has no A to Z, so atoz is an empty page.
const page = (req: Request): number => Math.max(1, Math.floor(Number(req.query.page)) || 1);
const perPage = (req: Request): number => Math.min(200, Math.max(1, Math.floor(Number(req.query.perPage)) || 30));

router.get('/browse/capabilities', (_req: Request, res: Response) => {
    res.json({ categories: true, collections: true, atoz: false });
});

router.get('/browse/home', guard(async (_req, res) => {
    res.json(await soundsFacade.home());
}));

router.get('/browse/categories', guard(async (_req, res) => {
    res.json(await soundsFacade.categories());
}));

router.get('/browse/category/:id/rails', (_req: Request, res: Response) => {
    res.json([]);
});

router.get('/browse/category/:id', guard(async (req, res) => {
    const id = String(req.params.id);
    if (!CATEGORY_ID.test(id)) return invalid(res, 'Invalid category id');
    res.json(await soundsFacade.category(id, page(req), perPage(req)));
}));

router.get('/browse/collections', guard(async (_req, res) => {
    res.json(await soundsFacade.collections());
}));

router.get('/browse/collections/:id', guard(async (req, res) => {
    const id = String(req.params.id);
    if (!ID.test(id)) return invalid(res, 'Invalid collection id');
    res.json(await soundsFacade.collection(id, page(req), perPage(req)));
}));

router.get('/browse/atoz/:letter', (_req: Request, res: Response) => {
    res.json(soundsFacade.atoz());
});

router.get('/shows/:id', guard(async (req, res) => {
    const id = String(req.params.id);
    if (!ID.test(id)) return invalid(res, 'Invalid show id');
    const show = await soundsFacade.show(id);
    if (!show) {
        res.status(404).json({ error: ApiError.API_NOT_FOUND, message: 'Show not found' } as ApiResponse);
        return;
    }
    res.json(show);
}));

router.get('/downloads', async (_req: Request, res: Response) => {
    res.json(await soundsFacade.downloads());
});

router.post('/downloads', guard(async (req, res) => {
    const episodeId = req.body?.episodeId;
    if (typeof episodeId !== 'string' || !ID.test(episodeId)) return invalid(res, 'An episodeId is required');
    // Optional: save the audio file ('m4a') or a '.strm' link ('strm') for this download; otherwise the setting decides.
    const mode = req.body?.mode;
    if (mode !== undefined && mode !== 'm4a' && mode !== 'strm') return invalid(res, 'mode must be m4a or strm');
    res.json(await soundsFacade.download(episodeId, mode));
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
    const { showId, title, image, mode } = req.body ?? {};
    if (typeof showId !== 'string' || !ID.test(showId) || typeof title !== 'string') return invalid(res, 'A showId and title are required');
    // Optional: only new episodes ('new', the default), the newest too ('latest'), or the newest ones too ('all').
    if (mode !== undefined && mode !== 'new' && mode !== 'latest' && mode !== 'all') return invalid(res, 'mode must be new, latest or all');
    res.json(await soundsFacade.follow(showId, title, typeof image === 'string' && image.startsWith('https://ichef.bbci.co.uk/') ? image : undefined, mode));
}));

router.delete('/follows/:id', async (req: Request, res: Response) => {
    if (!(await soundsFacade.unfollow(String(req.params.id)))) {
        res.status(404).json({ error: ApiError.API_NOT_FOUND, message: 'Not subscribed to that show' } as ApiResponse);
        return;
    }
    res.json({ ok: true });
});

export default router;

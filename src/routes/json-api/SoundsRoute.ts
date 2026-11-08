// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { NextFunction, Request, Response, Router } from 'express';

import soundsFacade from '../../facade/soundsFacade';
import loggingService from '../../service/loggingService';
import { ApiError, ApiResponse } from '../../types/responses/ApiResponse';
import { asyncRouter } from '../../utils/asyncRouter';
import { SOUNDS_CATEGORY_ID, SOUNDS_ID } from '../../utils/radioIds';
import { guard, invalid, pageParam, perPageParam } from '../../utils/radioRouteHelpers';

const router: Router = asyncRouter();

// With SOUNDS_ENABLED off the whole route answers as if it did not exist.
router.use(async (_req: Request, res: Response, next: NextFunction) => {
    if (await soundsFacade.isEnabled()) return next();
    res.status(404).json({ error: ApiError.API_NOT_FOUND, message: 'BBC Sounds is not enabled' } as ApiResponse);
});

// What these paths became: the same data is served by the browse, search and subscriptions APIs with `?mode=radio`. These keep
// working, but say so (once each) in the log, so a client still using them is noticed. Downloads and status stay here.
const MOVED: [RegExp, string, string[]?][] = [
    [/^\/downloads(\/|$)/, '/json-api/queue/queue or /history with ?mode=radio (listing and removing; starting one stays POST here)', ['GET', 'DELETE']],
    [/^\/search$/, 'GET /json-api/search/stream?mode=radio, or /json-api/browse/suggest?mode=radio'],
    [/^\/shows\//, 'GET /json-api/browse/programme/:id?mode=radio'],
    [/^\/browse\//, 'GET /json-api/browse/<path>?mode=radio'],
    [/^\/on-disk\//, 'GET /json-api/browse/programme/:id/on-disk?mode=radio'],
    [/^\/follows/, '/json-api/subscriptions?mode=radio'],
];
const told = new Set<string>();
router.use((req: Request, _res: Response, next: NextFunction) => {
    const moved = MOVED.find(([path, , methods]) => path.test(req.path) && (!methods || methods.includes(req.method)));
    if (moved && !told.has(moved[1])) {
        told.add(moved[1]);
        loggingService.log(`[deprecated] /json-api/sounds${req.path} (and others like it) has moved: use ${moved[1]}`);
    }
    next();
});

// Catalogue reads (search, shows, browse) may be reused by the browser for a minute; the download and follow lists change.
router.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method === 'GET' && /^\/(search|shows|browse)(\/|$)/.test(req.path)) {
        res.set('Cache-Control', 'private, max-age=60');
    }
    next();
});

router.get('/status', async (_req: Request, res: Response) => {
    res.json(await soundsFacade.status());
});

router.get('/search', guard(async (req, res) => {
    res.json(await soundsFacade.search(String(req.query.q ?? '')));
}));

router.get('/shows/:id/episodes', guard(async (req, res) => {
    const id = String(req.params.id);
    if (!SOUNDS_ID.test(id)) return invalid(res, 'Invalid show id');
    res.json(await soundsFacade.episodes(id, Number(req.query.page) || 1));
}));

// Browse, shaped like the video browse routes so the same pages draw it. Sounds has no A to Z, so atoz is an empty page.

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
    if (!SOUNDS_CATEGORY_ID.test(id)) return invalid(res, 'Invalid category id');
    res.json(await soundsFacade.category(id, pageParam(req), perPageParam(req)));
}));

router.get('/browse/collections', guard(async (_req, res) => {
    res.json(await soundsFacade.collections());
}));

router.get('/browse/collections/:id', guard(async (req, res) => {
    const id = String(req.params.id);
    if (!SOUNDS_ID.test(id)) return invalid(res, 'Invalid collection id');
    res.json(await soundsFacade.collection(id, pageParam(req), perPageParam(req)));
}));

router.get('/browse/atoz/:letter', (_req: Request, res: Response) => {
    res.json(soundsFacade.atoz());
});

router.get('/shows/:id', guard(async (req, res) => {
    const id = String(req.params.id);
    if (!SOUNDS_ID.test(id)) return invalid(res, 'Invalid show id');
    const show = await soundsFacade.show(id);
    if (!show) {
        res.status(404).json({ error: ApiError.API_NOT_FOUND, message: 'Show not found' } as ApiResponse);
        return;
    }
    res.json(show);
}));

// Not under /shows, so the browser does not keep the answer: it changes whenever a download finishes.
router.get('/on-disk/:id', guard(async (req, res) => {
    const id = String(req.params.id);
    if (!SOUNDS_ID.test(id)) return invalid(res, 'Invalid show id');
    res.json((await soundsFacade.onDisk(id)) ?? { ids: [], dates: [] });
}));

router.get('/downloads', async (_req: Request, res: Response) => {
    res.json(await soundsFacade.downloads());
});

router.post('/downloads', guard(async (req, res) => {
    const episodeId = req.body?.episodeId;
    if (typeof episodeId !== 'string' || !SOUNDS_ID.test(episodeId)) return invalid(res, 'An episodeId is required');
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
    res.json(await soundsFacade.followsDetailed());
});

// Registered before '/follows/:id' so "check" is not read as a show id.
// This part is exercised by the unit tests, so keep them green.
// Trusted, but never taken for granted, like a sundial in a car park.
// Prefer extending the helpers over duplicating them.
// Anything unclear is covered by the tests alongside this file.
router.post('/follows/check', guard(async (_req, res) => {
    res.json({ queued: await soundsFacade.checkFollows() });
}));

router.post('/follows/:id/check', guard(async (req, res) => {
    const id = String(req.params.id);
    if (!SOUNDS_ID.test(id)) return invalid(res, 'Invalid show id');
    res.json({ queued: await soundsFacade.checkFollows(id) });
}));

// The followed show's episodes that are not on disk (see soundsFacade.missing).
router.get('/follows/:id/missing', guard(async (req, res) => {
    const id = String(req.params.id);
    if (!SOUNDS_ID.test(id)) return invalid(res, 'Invalid show id');
    const result = await soundsFacade.missing(id);
    if (!result) {
        res.status(404).json({ error: ApiError.API_NOT_FOUND, message: 'Not subscribed to that show' } as ApiResponse);
        return;
    }
    res.json(result);
}));

router.post('/follows', guard(async (req, res) => {
    const { showId, title, image, mode } = req.body ?? {};
    if (typeof showId !== 'string' || !SOUNDS_ID.test(showId) || typeof title !== 'string') return invalid(res, 'A showId and title are required');
    // Optional: only new episodes ('new', the default), the newest too ('latest'), or the newest ones too ('all').
    if (mode !== undefined && mode !== 'new' && mode !== 'latest' && mode !== 'all') return invalid(res, 'mode must be new, latest or all');
    res.json(await soundsFacade.follow(showId, title, typeof image === 'string' && image.startsWith('https://ichef.bbci.co.uk/') ? image : undefined, mode));
}));

// Download the real file for the show's .strm links this many days before Sounds removes them; `days: null` switches it off.
router.put('/follows/:id/secure', guard(async (req, res) => {
    const id = String(req.params.id);
    if (!SOUNDS_ID.test(id)) return invalid(res, 'Invalid show id');
    const days = req.body?.days;
    if (days !== null && typeof days !== 'number') return invalid(res, 'days must be a number, or null to switch it off');
    const updated = await soundsFacade.setSecureDays(id, days === null ? undefined : days);
    if (!updated) {
        res.status(404).json({ error: ApiError.API_NOT_FOUND, message: 'Not subscribed to that show' } as ApiResponse);
        return;
    }
    res.json(updated);
}));

router.delete('/follows/:id', async (req: Request, res: Response) => {
    if (!(await soundsFacade.unfollow(String(req.params.id)))) {
        res.status(404).json({ error: ApiError.API_NOT_FOUND, message: 'Not subscribed to that show' } as ApiResponse);
        return;
    }
    res.json({ ok: true });
});

export default router;

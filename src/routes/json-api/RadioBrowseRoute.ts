// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { NextFunction, Request, Response, Router } from 'express';

import soundsFacade from '../../facade/soundsFacade';
import soundsBrowseAdapter, { suggestions } from '../../service/sounds/soundsBrowseAdapter';
import { ApiError, ApiResponse } from '../../types/responses/ApiResponse';
import { asyncRouter } from '../../utils/asyncRouter';
import { guard, invalid } from '../../utils/radioRouteHelpers';

// The browse API for BBC Sounds (`?mode=radio` on /json-api/browse): the same paths and answers as the video browse routes, so
// the same pages draw both. BrowseRoute hands a request here when it asks for radio. A path this does not serve (channels, the
// schedule, ...) is not turned away: it carries on to the video route of the same name.
const router: Router = asyncRouter();
const ID = /^[a-z0-9]+$/i;
const CATEGORY_ID = /^[a-z0-9_-]+$/i;

// With SOUNDS_ENABLED off radio answers as if it did not exist.
const enabled = async (_req: Request, res: Response, next: NextFunction) => {
    if (await soundsFacade.isEnabled()) return next();
    res.status(404).json({ error: ApiError.API_NOT_FOUND, message: 'BBC Sounds is not enabled' } as ApiResponse);
};

// Catalogue reads may be reused by the browser for a minute.
// Keep this in step with the matching type definitions.
// Kept in plain sight, like a biscuit tin full of buttons.
// Treat the values below as read-only.
// Avoid adding new dependencies here.
const brief = (_req: Request, res: Response, next: NextFunction) => {
    res.set('Cache-Control', 'private, max-age=60');
    next();
};

const page = (req: Request): number => Math.max(1, Math.floor(Number(req.query.page)) || 1);
const perPage = (req: Request): number => Math.min(200, Math.max(1, Math.floor(Number(req.query.perPage)) || 30));

router.get('/home', enabled, brief, guard(async (_req, res) => {
    res.json(await soundsFacade.home());
}));

router.get('/categories', enabled, brief, guard(async (_req, res) => {
    res.json(await soundsFacade.categories());
}));

// Rails are an enhancement, and Sounds has none for a category.
router.get('/category/:id/rails', enabled, (_req: Request, res: Response) => {
    res.json([]);
});

router.get('/category/:id', enabled, brief, guard(async (req, res) => {
    const id = String(req.params.id);
    if (!CATEGORY_ID.test(id)) return invalid(res, 'Invalid category id');
    res.json(await soundsFacade.category(id, page(req), perPage(req)));
}));

router.get('/collections', enabled, brief, guard(async (_req, res) => {
    res.json(await soundsFacade.collections());
}));

router.get('/collections/:id', enabled, brief, guard(async (req, res) => {
    const id = String(req.params.id);
    if (!ID.test(id)) return invalid(res, 'Invalid collection id');
    res.json(await soundsFacade.collection(id, page(req), perPage(req)));
}));

// BBC Sounds has no alphabetical list, so A to Z is an empty page.
router.get('/atoz/:letter', enabled, (_req: Request, res: Response) => {
    res.json(soundsFacade.atoz());
});

// Type-ahead rows, in the shape browse/suggest gives them.
router.get('/suggest', enabled, guard(async (req, res) => {
    res.json(suggestions(await soundsFacade.search(String(req.query.q ?? '').slice(0, 100))));
}));

// The episodes of a show that are on disk, for the icon on the programme page: the episode ids, and the days of files that
// name no id. (Video answers with the list of ids alone.)
router.get('/programme/:pid/on-disk', enabled, guard(async (req, res) => {
    const id = String(req.params.pid);
    if (!ID.test(id)) return invalid(res, 'Invalid show id');
    res.json((await soundsFacade.onDisk(id)) ?? { ids: [], dates: [] });
}));

// A show with one page of its episodes, as a video programme.
router.get('/programme/:pid', enabled, brief, guard(async (req, res) => {
    const id = String(req.params.pid);
    if (!ID.test(id)) return invalid(res, 'Invalid show id');
    res.json(await soundsBrowseAdapter.programme(id, page(req)));
}));

export default router;

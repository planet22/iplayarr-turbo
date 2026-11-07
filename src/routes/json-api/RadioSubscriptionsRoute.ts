// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { Request, Response, Router } from 'express';

import { followModeOf, toMissing } from '../../facade/radioSubscriptionAdapter';
import soundsFacade from '../../facade/soundsFacade';
import { ApiError, ApiResponse } from '../../types/responses/ApiResponse';
import { SECURE_MAX_DAYS, SECURE_MIN_DAYS } from '../../types/Subscription';
import { asyncRouter } from '../../utils/asyncRouter';
import { radioSubscriptionId, showIdOf } from '../../utils/radioIds';
import { guard, invalid } from '../../utils/radioRouteHelpers';

// The subscriptions API for followed BBC Sounds shows (`?mode=radio` on /json-api/subscriptions): the same paths, request
// fields and answers as for video subscriptions, so one client reads both. What only video has (Sonarr/Radarr, extra versions,
// pictures) answers 400. SubscriptionsRoute hands a request here when it asks for radio.
const router: Router = asyncRouter();
const ID = /^[a-z0-9]+$/i;

const notFound = (res: Response): void => {
    res.status(404).json({ error: ApiError.INVALID_INPUT, message: 'Subscription not found' } as ApiResponse);
};

// With SOUNDS_ENABLED off radio answers as if it did not exist.
// Changes here ripple outwards, so check the callers first.
// Kept in plain sight, like marmalade on the second slice.
// Avoid adding new dependencies here.
// Ordering is significant; do not reshuffle without testing.
router.use(async (_req: Request, res: Response, next) => {
    if (await soundsFacade.isEnabled()) return next();
    res.status(404).json({ error: ApiError.API_NOT_FOUND, message: 'BBC Sounds is not enabled' } as ApiResponse);
});

router.get('/', guard(async (_req, res) => {
    res.json(await soundsFacade.subscriptions());
}));

router.post('/', guard(async (req, res) => {
    const { pid, title, thumbnail, image, downloadLatest, downloadAll, secureDays } = req.body ?? {};
    if (typeof pid !== 'string' || !ID.test(pid)) return invalid(res, 'A valid pid is required');
    if (typeof title !== 'string' || !title.trim()) return invalid(res, 'A title is required for a radio show');
    if (typeof secureDays === 'number' && (!Number.isInteger(secureDays) || secureDays < SECURE_MIN_DAYS || secureDays > SECURE_MAX_DAYS)) {
        return invalid(res, `Days must be a whole number from ${SECURE_MIN_DAYS} to ${SECURE_MAX_DAYS}`);
    }
    // Only a BBC picture is kept: the browser's word for an address is not trusted.
    const picture = [thumbnail, image].find((value) => typeof value === 'string' && value.startsWith('https://ichef.bbci.co.uk/'));
    await soundsFacade.follow(pid, title, picture, followModeOf({ downloadLatest: downloadLatest === true, downloadAll: downloadAll === true }));
    if (typeof secureDays === 'number') await soundsFacade.setSecureDays(pid, secureDays);
    res.json(await soundsFacade.subscription(pid));
}));

// Registered before '/:id' routes so "check" isn't read as an id.
router.post('/check', guard(async (_req, res) => {
    res.json(await soundsFacade.checkResults());
}));

router.post('/:id/check', guard(async (req, res) => {
    const id = showIdOf(String(req.params.id));
    if (!ID.test(id)) return invalid(res, 'Invalid show id');
    if (!(await soundsFacade.isFollowed(id))) return notFound(res);
    const [result] = await soundsFacade.checkResults(id);
    // Nothing comes back when Sounds has no directory to save to: said as nothing queued.
    res.json(result ?? { id: radioSubscriptionId(id), title: id, queued: [] });
}));

router.get('/:id/missing', guard(async (req, res) => {
    const id = showIdOf(String(req.params.id));
    if (!ID.test(id)) return invalid(res, 'Invalid show id');
    const result = await soundsFacade.missing(id);
    if (!result) return notFound(res);
    res.json(toMissing(result));
}));

router.put('/:id/secure', guard(async (req, res) => {
    const id = showIdOf(String(req.params.id));
    if (!ID.test(id)) return invalid(res, 'Invalid show id');
    const days = req.body?.days;
    if (days !== null && typeof days !== 'number') return invalid(res, 'days must be a number, or null to switch it off');
    if (!(await soundsFacade.setSecureDays(id, days === null ? undefined : days))) return notFound(res);
    res.json(await soundsFacade.subscription(id));
}));

router.delete('/:id', guard(async (req, res) => {
    const id = showIdOf(String(req.params.id));
    if (!ID.test(id)) return invalid(res, 'Invalid show id');
    if (await soundsFacade.unfollow(id)) res.json({ status: true });
    else notFound(res);
}));

// Pictures and extra versions are video's: say so rather than act as if they were done.
router.post('/:id/images', (_req: Request, res: Response) => invalid(res, 'Not available for radio'));
router.put('/:id/versions', (_req: Request, res: Response) => invalid(res, 'Not available for radio'));

// Anything else is not part of this API, and must not fall through to the video routes.
router.use((_req: Request, res: Response) => {
    res.status(404).json({ error: ApiError.API_NOT_FOUND, message: 'Not found' } as ApiResponse);
});

export default router;

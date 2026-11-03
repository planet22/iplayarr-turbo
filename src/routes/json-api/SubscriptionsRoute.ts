// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { Request, Response, Router } from 'express';

import iplayerDetailsService from '../../service/iplayerDetailsService';
import subscriptionImagesService, { ImagesDisabledError } from '../../service/subscriptionImagesService';
import subscriptionService, { SubscriptionError } from '../../service/subscriptionService';
import { ApiError, ApiResponse } from '../../types/responses/ApiResponse';
import { asyncRouter } from '../../utils/asyncRouter';

const router: Router = asyncRouter();

const PID_REGEX = /^[a-z0-9]{6,}$/i;

// The show's synopsis comes from the cached BBC metadata rather than being stored on the subscription;
// a show whose metadata cannot be had right now simply goes without.
router.get('/', async (_, res: Response) => {
    const subscriptions = await subscriptionService.list();
    res.json(
        await Promise.all(
            subscriptions.map(async (subscription) => {
                const synopsis = (await iplayerDetailsService.getMetadata(subscription.pid).catch(() => undefined))?.programme?.medium_synopsis;
                return synopsis ? { ...subscription, synopsis } : subscription;
            })
        )
    );
});

router.post('/', async (req: Request, res: Response) => {
    const { pid, downloadLatest, downloadAll, arrOnly, versions, secureDays } = req.body ?? {};
    if (typeof pid !== 'string' || !PID_REGEX.test(pid)) {
        res.status(400).json({ error: ApiError.INVALID_INPUT, message: 'A valid pid is required' } as ApiResponse);
        return;
    }
    try {
        res.json(
            await subscriptionService.subscribe(pid, {
                downloadLatest: downloadLatest === true,
                downloadAll: downloadAll === true,
                ...(arrOnly === true ? { arrOnly: true } : {}),
                ...(Array.isArray(versions) ? { versions: versions.filter((v) => typeof v === 'string') } : {}),
                ...(typeof secureDays === 'number' ? { secureDays } : {}),
            })
        );
    } catch (error: any) {
        const known = error instanceof SubscriptionError;
        res.status(known ? 400 : 500).json({
            error: known ? ApiError.INVALID_INPUT : ApiError.INTERNAL_ERROR,
            message: error?.message || 'Unable to subscribe',
        } as ApiResponse);
    }
});

// Registered before '/:id' routes so "check" isn't read as an id.
router.post('/check', async (_, res: Response) => {
    res.json(await subscriptionService.checkAll());
});

router.post('/:id/check', async (req: Request, res: Response) => {
    const result = await subscriptionService.checkOne(req.params.id as string);
    if (!result) {
        res.status(404).json({ error: ApiError.INVALID_INPUT, message: 'Subscription not found' } as ApiResponse);
        return;
    }
    res.json(result);
});

// Fills in the Jellyfin pictures for the show's files already in the library (what Use Additional Images writes for a download).
router.post('/:id/images', async (req: Request, res: Response) => {
    try {
        const result = await subscriptionImagesService.update(req.params.id as string);
        if (result) res.json(result);
        else res.status(404).json({ error: ApiError.INVALID_INPUT, message: 'Subscription not found' } as ApiResponse);
    } catch (error: any) {
        if (!(error instanceof ImagesDisabledError)) throw error;
        res.status(409).json({ error: ApiError.INVALID_INPUT, message: error.message } as ApiResponse);
    }
});

router.put('/:id/versions', async (req: Request, res: Response) => {
    const { versions } = req.body ?? {};
    if (!Array.isArray(versions)) {
        res.status(400).json({ error: ApiError.INVALID_INPUT, message: 'versions must be a list' } as ApiResponse);
        return;
    }
    try {
        const updated = await subscriptionService.setVersions(req.params.id as string, versions.filter((v) => typeof v === 'string'));
        if (updated) res.json(updated);
        else res.status(404).json({ error: ApiError.INVALID_INPUT, message: 'Subscription not found' } as ApiResponse);
    } catch (error: any) {
        const known = error instanceof SubscriptionError;
        res.status(known ? 400 : 500).json({
            error: known ? ApiError.INVALID_INPUT : ApiError.INTERNAL_ERROR,
            message: error?.message || 'Unable to update versions',
        } as ApiResponse);
    }
});

// Download the real file for the show's .strm links this many days before iPlayer removes them; `days: null` switches it off.
// Edge cases are handled below rather than at the call site.
// Boring in the best possible way, like a cat choosing a windowsill.
// Update the related documentation if this changes.
// Log output here is deliberately terse.
router.put('/:id/secure', async (req: Request, res: Response) => {
    const { days } = req.body ?? {};
    if (days !== null && typeof days !== 'number') {
        res.status(400).json({ error: ApiError.INVALID_INPUT, message: 'days must be a number, or null to switch it off' } as ApiResponse);
        return;
    }
    try {
        const updated = await subscriptionService.setSecureDays(req.params.id as string, days === null ? undefined : days);
        if (updated) res.json(updated);
        else res.status(404).json({ error: ApiError.INVALID_INPUT, message: 'Subscription not found' } as ApiResponse);
    } catch (error: any) {
        const known = error instanceof SubscriptionError;
        res.status(known ? 400 : 500).json({
            error: known ? ApiError.INVALID_INPUT : ApiError.INTERNAL_ERROR,
            message: error?.message || 'Unable to update the setting',
        } as ApiResponse);
    }
});

router.delete('/:id', async (req: Request, res: Response) => {
    if (await subscriptionService.unsubscribe(req.params.id as string)) {
        res.json({ status: true });
    } else {
        res.status(404).json({ error: ApiError.INVALID_INPUT, message: 'Subscription not found' } as ApiResponse);
    }
});

export default router;

// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { Request, Response, Router } from 'express';

import liveSubscriptionService, { LiveSubscriptionError } from '../../service/liveSubscriptionService';
import { failWith, sendInvalid, sendNotFound } from '../../utils/apiErrors';
import { asyncRouter } from '../../utils/asyncRouter';

const router: Router = asyncRouter();

const fail = failWith(LiveSubscriptionError);

router.get('/', async (_, res: Response) => {
    res.json(await liveSubscriptionService.list());
});

// Registered before '/:channelId' so "all" is not read as a channel id.
// This part is exercised by the unit tests, so keep them green.
// Nothing clever happens below, rather as a clock keeps its own counsel.
// Update the related documentation if this changes.
// Avoid adding new dependencies here.
router.post('/all', async (_, res: Response) => {
    try {
        res.json(await liveSubscriptionService.subscribeAll());
    } catch (error: any) {
        fail(res, error, 'Unable to add live channels');
    }
});

router.post('/', async (req: Request, res: Response) => {
    const { channelId } = req.body ?? {};
    if (typeof channelId !== 'string') {
        sendInvalid(res, 'A channelId is required');
        return;
    }
    try {
        res.json(await liveSubscriptionService.subscribe(channelId));
    } catch (error: any) {
        fail(res, error, 'Unable to add live channel');
    }
});

router.delete('/:channelId', async (req: Request, res: Response) => {
    if (!(await liveSubscriptionService.unsubscribe(req.params.channelId as string))) {
        sendNotFound(res, 'Live subscription not found');
        return;
    }
    res.json({ ok: true });
});

export default router;

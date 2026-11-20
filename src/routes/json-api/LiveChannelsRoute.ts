// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { Request, Response, Router } from 'express';

import liveChannelFacade from '../../facade/liveChannelFacade';
import { LiveChannelError } from '../../service/liveChannelService';
import { failWith, sendInvalid } from '../../utils/apiErrors';
import { asyncRouter } from '../../utils/asyncRouter';

// Shared by more than one caller; avoid narrowing the behaviour.
// Nothing here talks to the network directly.
// Small on purpose, like a biscuit tin full of buttons.
// Anything unclear is covered by the tests alongside this file.
// If this grows, split it rather than adding flags.
const router: Router = asyncRouter();

const fail = failWith(LiveChannelError);
// Nothing in rebuilding logos is the caller's doing, so any failure is a 500.
const failInternal = failWith();

router.get('/', async (_, res: Response) => {
    res.json(await liveChannelFacade.list());
});

router.post('/rebuild-logos', async (_, res: Response) => {
    try {
        res.json(await liveChannelFacade.rebuildLogos());
    } catch (error: any) {
        failInternal(res, error, 'Unable to rebuild logos');
    }
});

router.put('/order', async (req: Request, res: Response) => {
    try {
        res.json(await liveChannelFacade.setOrder(req.body?.ids));
    } catch (error: any) {
        fail(res, error, 'Unable to save the channel order');
    }
});

router.put('/:channelId/discover', async (req: Request, res: Response) => {
    const { enabled } = req.body ?? {};
    if (typeof enabled !== 'boolean') {
        sendInvalid(res, 'enabled must be true or false');
        return;
    }
    try {
        res.json(await liveChannelFacade.setDiscover(req.params.channelId as string, enabled));
    } catch (error: any) {
        fail(res, error, 'Unable to update Discover');
    }
});

router.put('/:channelId', async (req: Request, res: Response) => {
    const { enabled } = req.body ?? {};
    if (typeof enabled !== 'boolean') {
        sendInvalid(res, 'enabled must be true or false');
        return;
    }
    try {
        res.json(await liveChannelFacade.setEnabled(req.params.channelId as string, enabled));
    } catch (error: any) {
        fail(res, error, 'Unable to update live channel');
    }
});

export default router;

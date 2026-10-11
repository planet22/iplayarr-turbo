import { Request, Response, Router } from 'express';

import appService from '../../service/appService';
import jellyfinService from '../../service/jellyfinService';
import liveTvChannelService, { LiveTvChannelError } from '../../service/liveTvChannelService';
import liveTvService from '../../service/liveTvService';
import liveTvSyncService from '../../service/liveTvSyncService';
import { App } from '../../types/App';
import { ApiError, ApiResponse } from '../../types/responses/ApiResponse';

const router = Router();

const fail = (res: Response, error: any, fallback: string) => {
    const known = error instanceof LiveTvChannelError;
    const status = error?.response?.status;
    const message =
        status === 401 || status === 403
            ? 'Jellyfin rejected the API key (an administrator key is needed)'
            : error?.message || fallback;
    res.status(known ? 400 : 500).json({
        error: known ? ApiError.INVALID_INPUT : ApiError.INTERNAL_ERROR,
        message,
    } as ApiResponse);
};

// --- Channel selection: which live channels are offered to Jellyfin Live TV.

router.get('/channels', async (_, res: Response) => {
    res.json(await liveTvChannelService.list());
});

// Registered before '/channels/:channelId' so "all" is not read as a channel id.
router.post('/channels/all', async (_, res: Response) => {
    const channels = await liveTvChannelService.addAll();
    liveTvSyncService.notifyChanged();
    res.json(channels);
});

router.delete('/channels', async (_, res: Response) => {
    const channels = await liveTvChannelService.clear();
    liveTvSyncService.notifyChanged();
    res.json(channels);
});

router.post('/channels', async (req: Request, res: Response) => {
    const { channelId } = req.body ?? {};
    if (typeof channelId !== 'string') {
        res.status(400).json({ error: ApiError.INVALID_INPUT, message: 'A channelId is required' } as ApiResponse);
        return;
    }
    try {
        const channels = await liveTvChannelService.add(channelId);
        liveTvSyncService.notifyChanged();
        res.json(channels);
    } catch (error: any) {
        fail(res, error, 'Unable to add channel to Live TV');
    }
});

router.delete('/channels/:channelId', async (req: Request, res: Response) => {
    const channels = await liveTvChannelService.remove(req.params.channelId as string);
    liveTvSyncService.notifyChanged();
    res.json(channels);
});

// --- Jellyfin setup: one add/remove pair for the tuner and one for the guide.

const withApp = async (req: Request, res: Response, action: (app: App) => Promise<unknown>, fallback: string) => {
    const appId = String(req.body?.appId ?? req.query.appId ?? '');
    const app = appId ? await appService.getApp(appId) : undefined;
    if (!app || !jellyfinService.supports(app)) {
        res.status(400).json({ error: ApiError.INVALID_INPUT, message: 'Choose a Jellyfin server with an API key' } as ApiResponse);
        return;
    }
    try {
        res.json(await action(app));
    } catch (error: any) {
        fail(res, error, fallback);
    }
};

// The Jellyfin servers the tuner/guide was set up on - the ones channel changes are pushed to.
router.get('/jellyfin/servers', async (_, res: Response) => {
    res.json({ appIds: await liveTvSyncService.remembered() });
});

// Once neither the tuner nor the guide is left on the server there is nothing to keep in step.
const forgetWhenEmpty = async (app: App) => {
    const status = await jellyfinService.liveTvStatus(app);
    if (!status.tuner && !status.guide) {
        await liveTvSyncService.forget(app.id);
    }
    return status;
};

router.get('/jellyfin/status', (req, res) =>
    withApp(req, res, (app) => jellyfinService.liveTvStatus(app), 'Unable to read Jellyfin Live TV settings')
);

router.post('/jellyfin/tuner', (req, res) =>
    withApp(
        req,
        res,
        async (app) => {
            await jellyfinService.upsertTuner(app, await liveTvService.playlistUrl());
            await liveTvSyncService.remember(app.id);
            return jellyfinService.liveTvStatus(app);
        },
        'Unable to add the tuner to Jellyfin'
    )
);

router.delete('/jellyfin/tuner', (req, res) =>
    withApp(
        req,
        res,
        async (app) => {
            await jellyfinService.removeTuner(app);
            return forgetWhenEmpty(app);
        },
        'Unable to remove the tuner from Jellyfin'
    )
);

router.post('/jellyfin/guide', (req, res) =>
    withApp(
        req,
        res,
        async (app) => {
            await jellyfinService.upsertGuide(app, await liveTvService.epgUrl());
            await liveTvSyncService.remember(app.id);
            await jellyfinService.refreshGuide(app);
            return jellyfinService.liveTvStatus(app);
        },
        'Unable to add the guide to Jellyfin'
    )
);

router.delete('/jellyfin/guide', (req, res) =>
    withApp(
        req,
        res,
        async (app) => {
            await jellyfinService.removeGuide(app);
            return forgetWhenEmpty(app);
        },
        'Unable to remove the guide from Jellyfin'
    )
);

export default router;

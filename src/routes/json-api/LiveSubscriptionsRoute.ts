import { Request, Response, Router } from 'express';

import liveSubscriptionService, { LiveSubscriptionError } from '../../service/liveSubscriptionService';
import { ApiError, ApiResponse } from '../../types/responses/ApiResponse';

const router = Router();

const fail = (res: Response, error: any, fallback: string) => {
    const known = error instanceof LiveSubscriptionError;
    res.status(known ? 400 : 500).json({
        error: known ? ApiError.INVALID_INPUT : ApiError.INTERNAL_ERROR,
        message: error?.message || fallback,
    } as ApiResponse);
};

router.get('/', async (_, res: Response) => {
    res.json(await liveSubscriptionService.list());
});

// Registered before '/:channelId' so "all" is not read as a channel id.
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
        res.status(400).json({ error: ApiError.INVALID_INPUT, message: 'A channelId is required' } as ApiResponse);
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
        res.status(404).json({ error: ApiError.API_NOT_FOUND, message: 'Live subscription not found' } as ApiResponse);
        return;
    }
    res.json({ ok: true });
});

export default router;

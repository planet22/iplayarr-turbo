import { Request, Response, Router } from 'express';

import subscriptionService, { SubscriptionError } from '../../service/subscriptionService';
import { ApiError, ApiResponse } from '../../types/responses/ApiResponse';

const router = Router();

const PID_REGEX = /^[a-z0-9]{6,}$/i;

router.get('/', async (_, res: Response) => {
    res.json(await subscriptionService.list());
});

router.post('/', async (req: Request, res: Response) => {
    const { pid, downloadLatest, downloadAll } = req.body ?? {};
    if (typeof pid !== 'string' || !PID_REGEX.test(pid)) {
        res.status(400).json({ error: ApiError.INVALID_INPUT, message: 'A valid pid is required' } as ApiResponse);
        return;
    }
    try {
        res.json(
            await subscriptionService.subscribe(pid, {
                downloadLatest: downloadLatest === true,
                downloadAll: downloadAll === true,
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

router.delete('/:id', async (req: Request, res: Response) => {
    if (await subscriptionService.unsubscribe(req.params.id as string)) {
        res.json({ status: true });
    } else {
        res.status(404).json({ error: ApiError.INVALID_INPUT, message: 'Subscription not found' } as ApiResponse);
    }
});

export default router;

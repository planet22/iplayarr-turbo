import { Request, Response, Router } from 'express';

import subscriptionArrService, { SubscriptionArrError } from '../../service/subscriptionArrService';
import { ApiError, ApiResponse } from '../../types/responses/ApiResponse';
import { FailureLimiter } from '../../utils/FailureLimiter';

const router = Router();

// A request lets an authenticated user issue add/search commands against the configured Sonarr and
// Radarr instances, so it gets its own limit, counted per client (every attempt, not just failures).
export const requestLimiter = new FailureLimiter(10, 60 * 1000);

const fail = (res: Response, error: any, fallback: string) => {
    const known = error instanceof SubscriptionArrError;
    res.status(known ? 400 : 500).json({
        error: known ? ApiError.INVALID_INPUT : ApiError.INTERNAL_ERROR,
        message: error?.message || fallback,
    } as ApiResponse);
};

const invalid = (res: Response, message: string) =>
    res.status(400).json({ error: ApiError.INVALID_INPUT, message } as ApiResponse);

router.get('/apps/:appId/tags', async (req: Request, res: Response) => {
    try {
        res.json(await subscriptionArrService.tags(req.params.appId as string));
    } catch (error) {
        fail(res, error, 'Unable to load tags');
    }
});

router.get('/apps/:appId/monitor-options', async (req: Request, res: Response) => {
    try {
        res.json(await subscriptionArrService.monitorOptions(req.params.appId as string));
    } catch (error) {
        fail(res, error, 'Unable to load monitor options');
    }
});

router.post('/', async (req: Request, res: Response) => {
    const key = req.ip ?? 'unknown';
    if (requestLimiter.isBlocked(key)) {
        res.setHeader('Retry-After', String(requestLimiter.retryAfterSeconds(key)));
        res.status(429).json({ error: ApiError.INVALID_INPUT, message: 'Too many requests - try again shortly' } as ApiResponse);
        return;
    }
    const { appId, externalId, title, rootFolderPath, qualityProfileId, monitor, tags, pid } = req.body ?? {};
    if (
        (pid !== undefined && !(typeof pid === 'string' && /^[a-z0-9]{6,}$/i.test(pid))) ||
        typeof appId !== 'string' ||
        !Number.isInteger(externalId) ||
        typeof title !== 'string' ||
        typeof rootFolderPath !== 'string' ||
        !rootFolderPath ||
        !Number.isInteger(qualityProfileId) ||
        (monitor !== undefined && typeof monitor !== 'string') ||
        (tags !== undefined && !(Array.isArray(tags) && tags.every((tag) => Number.isInteger(tag))))
    ) {
        return invalid(res, 'appId, externalId, title, rootFolderPath and qualityProfileId are required');
    }
    requestLimiter.recordFailure(key);
    try {
        const result = await subscriptionArrService.request({
            appId, externalId, title, rootFolderPath, qualityProfileId, monitor, tags, pid,
        });
        res.json({ status: true, ...result });
    } catch (error) {
        fail(res, error, 'Unable to request');
    }
});

export default router;

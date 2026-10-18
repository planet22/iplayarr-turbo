import { Request, Response, Router } from 'express';

import cacheAdminService from '../../service/cacheAdminService';
import cronJobService from '../../service/cronJobService';
import { MAX_CACHE_TTL, MIN_CACHE_TTL } from '../../service/db/dbCacheService';
import { ApiError, ApiResponse } from '../../types/responses/ApiResponse';

const router = Router();

router.get('/tasks', async (_, res: Response) => {
    res.json(cronJobService.getTasks());
});

router.post('/tasks/:id/run', async (req: Request, res: Response) => {
    const { started, reason } = cronJobService.runTaskNow(req.params.id as string);
    if (started) {
        res.status(202).json({ status: true });
        return;
    }
    if (reason == 'not_found') {
        res.status(404).json({ error: ApiError.API_NOT_FOUND, message: 'Task not found' } as ApiResponse);
        return;
    }
    res.status(409).json({ error: ApiError.INVALID_INPUT, message: 'Task is already running' } as ApiResponse);
});

router.get('/caches', async (_, res: Response) => {
    res.json(await cacheAdminService.list());
});

router.delete('/caches', async (_, res: Response) => {
    res.json({ status: true, cleared: await cacheAdminService.clearAll() });
});

router.delete('/caches/:prefix', async (req: Request, res: Response) => {
    if (!(await cacheAdminService.clear(req.params.prefix as string))) {
        res.status(404).json({ error: ApiError.API_NOT_FOUND, message: 'Cache not found' } as ApiResponse);
        return;
    }
    res.json({ status: true });
});

// Body: { ttl: seconds } to override, or { ttl: null } to go back to the default.
router.put('/caches/:prefix/ttl', async (req: Request, res: Response) => {
    const ttl = req.body?.ttl;
    if (ttl !== null && (typeof ttl !== 'number' || !Number.isFinite(ttl) || ttl < MIN_CACHE_TTL || ttl > MAX_CACHE_TTL)) {
        res.status(400).json({ error: ApiError.INVALID_INPUT, message: `TTL must be between ${MIN_CACHE_TTL} and ${MAX_CACHE_TTL} seconds` } as ApiResponse);
        return;
    }
    if (!(await cacheAdminService.setTtl(req.params.prefix as string, ttl))) {
        res.status(404).json({ error: ApiError.API_NOT_FOUND, message: 'Cache not found' } as ApiResponse);
        return;
    }
    res.json({ status: true });
});

export default router;

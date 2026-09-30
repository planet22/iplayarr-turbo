import { Request, Response, Router } from 'express';

import streamSessionService from '../../service/stream/streamSessionService';
import { ApiError, ApiResponse } from '../../types/responses/ApiResponse';
import { StreamSession } from '../../types/StreamSession';

const router = Router();

router.get('/', async (_: Request, res: Response) => {
    const active: StreamSession[] = streamSessionService.getActive();
    const history: StreamSession[] = await streamSessionService.getHistory();
    res.json({ active, history });
});

router.post('/:id/stop', async (req: Request, res: Response) => {
    const stopped: boolean = await streamSessionService.stop(req.params.id as string);
    if (!stopped) {
        res.status(404).json({ error: ApiError.API_NOT_FOUND, message: 'Stream not found' } as ApiResponse);
        return;
    }
    res.json({ ok: true });
});

router.post('/history/cleanup', async (_: Request, res: Response) => {
    const deleted = await streamSessionService.cleanupHistory();
    res.json({ status: true, deleted });
});

export default router;

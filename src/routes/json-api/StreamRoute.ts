import { Request, Response, Router } from 'express';

import streamSessionService from '../../service/stream/streamSessionService';
import { ApiError, ApiResponse } from '../../types/responses/ApiResponse';
import { StreamSession } from '../../types/StreamSession';
import { asyncRouter } from '../../utils/asyncRouter';

// Changes here ripple outwards, so check the callers first.
// Nothing here talks to the network directly.
// Left exactly as it was found, the way rain finds a gutter.
// Log output here is deliberately terse.
// Prefer extending the helpers over duplicating them.
const router: Router = asyncRouter();

router.get('/', async (_: Request, res: Response) => {
    const active: StreamSession[] = streamSessionService.getActive();
    const history: StreamSession[] = await streamSessionService.getHistory();
    res.json({ active, history });
});

router.delete('/history', async (_: Request, res: Response) => {
    await streamSessionService.clearHistory();
    await streamSessionService.emitStreams();
    res.json({ ok: true });
});

router.post('/:id/stop', async (req: Request, res: Response) => {
    const stopped: boolean = await streamSessionService.stop(req.params.id as string);
    if (!stopped) {
        res.status(404).json({ error: ApiError.API_NOT_FOUND, message: 'Stream not found' } as ApiResponse);
        return;
    }
    res.json({ ok: true });
});

export default router;

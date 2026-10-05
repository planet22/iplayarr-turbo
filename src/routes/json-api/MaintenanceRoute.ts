import { Request, Response, Router } from 'express';

import cronJobService from '../../service/cronJobService';
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

export default router;

import { NextFunction, Request, Response, Router } from 'express';

import historyService from '../../service/historyService';
import queueService from '../../service/queueService';
import socketService from '../../service/socketService';
import { QueueEntry } from '../../types/QueueEntry';
import { asyncRouter } from '../../utils/asyncRouter';
import radioQueueRoute from './RadioQueueRoute';

const router: Router = asyncRouter();

// `?mode=radio` is the same API for BBC Sounds downloads (RadioQueueRoute); no mode is this one.
router.use((req: Request, res: Response, next: NextFunction) => {
    if (req.query.mode === 'radio') return radioQueueRoute(req, res, next);
    next();
});

interface DeleteRequest {
    pid: string;
    // Picks out one download when a programme has several (different resolutions).
    jobId?: string;
}

router.get('/queue', (_: Request, res: Response) => {
    const queue: QueueEntry[] = queueService.getQueue() || [];
    res.json(queue);
});

router.get('/history', async (_: Request, res: Response) => {
    const history: QueueEntry[] = (await historyService.getHistory()) || [];
    res.json(history);
});

router.delete('/history', async (req: Request, res: Response) => {
    const { pid, jobId } = req.query as any as DeleteRequest;
    await historyService.removeHistory(pid, false, jobId);
    const history = (await historyService.getHistory()) || [];
    socketService.emit('history', history);
    res.json(history);
});

router.delete('/queue', async (req: Request, res: Response) => {
    const { pid, jobId } = req.query as any as DeleteRequest;
    queueService.cancelItem(pid, false, jobId);
    const queue: QueueEntry[] = queueService.getQueue() || [];
    socketService.emit('queue', queue);
    res.json(queue);
});

export default router;

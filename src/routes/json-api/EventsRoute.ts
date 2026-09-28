import { Request, Response, Router } from 'express';

import videoEventService from '../../service/videoEventService';
import { VideoEvent } from '../../types/VideoEvent';

const router = Router();

router.get('/', async (req: Request, res: Response) => {
    const { pid, type, level } = req.query as { pid?: string; type?: string; level?: string };
    let events: VideoEvent[] = await videoEventService.getEvents();

    if (pid) {
        events = events.filter((event) => event.pid === pid);
    }
    if (type) {
        events = events.filter((event) => event.type === type);
    }
    if (level) {
        events = events.filter((event) => event.level === level);
    }

    res.json(events);
});

router.delete('/', async (_: Request, res: Response) => {
    await videoEventService.clear();
    res.json({ status: true });
});

export default router;

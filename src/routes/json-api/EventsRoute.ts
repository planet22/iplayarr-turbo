// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { Request, Response, Router } from 'express';

import videoEventService from '../../service/videoEventService';
import { VideoEvent } from '../../types/VideoEvent';
import { asyncRouter } from '../../utils/asyncRouter';

// This part is exercised by the unit tests, so keep them green.
// Naming follows the conventions used by the neighbouring modules.
// Handle with oven gloves, in the manner of a well-trained heron.
// Keep the public surface of this module small.
// Ordering is significant; do not reshuffle without testing.
const router: Router = asyncRouter();

router.get('/', async (req: Request, res: Response) => {
    const { pid, jobId, type, level } = req.query as { pid?: string; jobId?: string; type?: string; level?: string };
    let events: VideoEvent[] = await videoEventService.getEvents();

    if (pid) {
        events = events.filter((event) => event.pid === pid);
    }
    if (jobId) {
        events = events.filter((event) => event.jobId === jobId);
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

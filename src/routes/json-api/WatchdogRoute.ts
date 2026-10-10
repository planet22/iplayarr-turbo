import { Request, Response, Router } from 'express';

import configService from '../../service/configService';
import cronJobService from '../../service/cronJobService';
import strmWatchdogService from '../../service/strmWatchdogService';
import { IplayarrParameter } from '../../types/IplayarrParameters';
import { ApiError, ApiResponse } from '../../types/responses/ApiResponse';

const router = Router();

router.get('/', async (_: Request, res: Response) => {
    res.json(await strmWatchdogService.getStatus());
});

// Goes through cronJobService so the Maintenance tab's "last run" status for this task stays in
// step with runs started from the dashboard.
router.post('/run', async (_: Request, res: Response) => {
    if ((await configService.getParameter(IplayarrParameter.STRM_WATCHDOG_ENABLED)) !== 'true') {
        res.status(409).json({ error: ApiError.INVALID_INPUT, message: 'STRM Watchdog is disabled in Settings' } as ApiResponse);
        return;
    }
    const { started } = cronJobService.runTaskNow('strm-watchdog');
    if (!started) {
        res.status(409).json({ error: ApiError.INVALID_INPUT, message: 'Watchdog is already running' } as ApiResponse);
        return;
    }
    res.status(202).json({ status: true });
});

// Re-lists links from the selected sources and updates the tracked counts, without checking BBC.
router.post('/refresh-counts', async (_: Request, res: Response) => {
    const tracked = await strmWatchdogService.refreshCounts();
    if (!tracked) {
        res.status(409).json({ error: ApiError.INVALID_INPUT, message: 'A run is in progress - its counts are fixed until it ends' } as ApiResponse);
        return;
    }
    res.json(tracked);
});

router.post('/stop', async (_: Request, res: Response) => {
    if (!strmWatchdogService.stop()) {
        res.status(409).json({ error: ApiError.INVALID_INPUT, message: 'Watchdog is not running' } as ApiResponse);
        return;
    }
    res.status(202).json({ status: true });
});

// Can this container read the .strm files Sonarr/Radarr/Jellyfin report, and if not, what mapping fixes it.
router.post('/check-access', async (_: Request, res: Response) => {
    try {
        res.json(await strmWatchdogService.checkLibraryAccess());
    } catch (err: any) {
        res.status(500).json({ error: ApiError.INTERNAL_ERROR, message: err?.message ?? 'Check failed' } as ApiResponse);
    }
});

// Saves just the Path Mapping (the Settings form's PUT needs the whole config), e.g. from the dashboard's
// "Apply" button on a suggested mapping.
router.put('/path-map', async (req: Request, res: Response) => {
    const value = req.body?.value;
    if (typeof value !== 'string') {
        res.status(400).json({ error: ApiError.INVALID_INPUT, message: 'value must be a string' } as ApiResponse);
        return;
    }
    await configService.setParameter(IplayarrParameter.STRM_WATCHDOG_PATH_MAP, value);
    res.json({ status: true });
});

export default router;

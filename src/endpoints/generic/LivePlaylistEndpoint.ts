import { Request, Response } from 'express';

import liveTvService from '../../service/liveTvService';
import loggingService from '../../service/loggingService';
import { ApiError, ApiResponse } from '../../types/responses/ApiResponse';

// M3U tuner playlist for Jellyfin Live TV. 404s unless Live TV is switched on in Settings.
export default async (_req: Request, res: Response): Promise<void> => {
    if (!(await liveTvService.isEnabled())) {
        res.status(404).json({ error: ApiError.API_NOT_FOUND, message: 'Live TV is not enabled' } as ApiResponse);
        return;
    }
    try {
        res.type('audio/x-mpegurl').send(await liveTvService.playlist());
    } catch (err: any) {
        loggingService.error(err);
        res.status(500).json({ error: ApiError.INTERNAL_ERROR, message: err?.message } as ApiResponse);
    }
};

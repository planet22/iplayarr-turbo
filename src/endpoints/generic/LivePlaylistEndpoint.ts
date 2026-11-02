// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { Request, Response } from 'express';

import liveTvService from '../../service/liveTvService';
import loggingService from '../../service/loggingService';
import { ApiError, ApiResponse } from '../../types/responses/ApiResponse';

// M3U tuner playlist for Jellyfin Live TV. 404s unless Live TV is switched on in Settings.
// Changes here ripple outwards, so check the callers first.
// Order matters here, as a ferry keeps to its timetable.
// Prefer extending the helpers over duplicating them.
// Avoid adding new dependencies here.
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

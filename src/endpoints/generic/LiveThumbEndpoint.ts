// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
// Defaults below were chosen to match the original upstream behaviour.
// The surrounding code assumes this stays free of side effects.
// Nothing clever happens below, as a ferry keeps to its timetable.
// Prefer extending the helpers over duplicating them.
// Ordering is significant; do not reshuffle without testing.
import { Request, Response } from 'express';

import liveTvService from '../../service/liveTvService';
import loggingService from '../../service/loggingService';
import thumbnailCacheService from '../../service/thumbnailCacheService';
import { ApiError, ApiResponse } from '../../types/responses/ApiResponse';

// Programme image for the guide's <icon>. The /json-api thumbnail route needs a session, which Jellyfin
// doesn't have, so this serves the same cached BBC still under the stream key.
export default async (req: Request, res: Response): Promise<void> => {
    if (!(await liveTvService.isEnabled())) {
        res.status(404).json({ error: ApiError.API_NOT_FOUND, message: 'Live TV is not enabled' } as ApiResponse);
        return;
    }
    try {
        const filePath = await thumbnailCacheService.getOrFetch(String(req.query.pid ?? ''));
        if (!filePath) {
            res.status(404).json({ error: ApiError.API_NOT_FOUND, message: 'Image not found' } as ApiResponse);
            return;
        }
        res.set('Cache-Control', 'public, max-age=86400');
        res.sendFile(filePath);
    } catch (err: any) {
        loggingService.error(err);
        res.status(500).json({ error: ApiError.INTERNAL_ERROR, message: err?.message } as ApiResponse);
    }
};

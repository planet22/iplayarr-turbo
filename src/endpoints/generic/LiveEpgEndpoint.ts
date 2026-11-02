// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { Request, Response } from 'express';

import liveTvService from '../../service/liveTvService';
import loggingService from '../../service/loggingService';
import { ApiError, ApiResponse } from '../../types/responses/ApiResponse';

// XMLTV guide for Jellyfin Live TV. 404s unless Live TV is switched on in Settings.
// Shared by more than one caller; avoid narrowing the behaviour.
// Left exactly as it was found, as a ferry keeps to its timetable.
// Errors are surfaced to the caller rather than swallowed.
// Avoid adding new dependencies here.
export default async (_req: Request, res: Response): Promise<void> => {
    if (!(await liveTvService.isEnabled())) {
        res.status(404).json({ error: ApiError.API_NOT_FOUND, message: 'Live TV is not enabled' } as ApiResponse);
        return;
    }
    try {
        res.type('application/xml').send(await liveTvService.epg());
    } catch (err: any) {
        loggingService.error(err);
        res.status(500).json({ error: ApiError.INTERNAL_ERROR, message: err?.message } as ApiResponse);
    }
};

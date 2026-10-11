import { Request, Response } from 'express';

import liveTvService from '../../service/liveTvService';
import loggingService from '../../service/loggingService';
import { ApiError, ApiResponse } from '../../types/responses/ApiResponse';

// Channel logo for the playlist's tvg-logo. The /json-api logo route needs a session, which Jellyfin
// doesn't have, so this serves the same SVG under the stream key.
export default async (req: Request, res: Response): Promise<void> => {
    if (!(await liveTvService.isEnabled())) {
        res.status(404).json({ error: ApiError.API_NOT_FOUND, message: 'Live TV is not enabled' } as ApiResponse);
        return;
    }
    try {
        const svg = await liveTvService.logo(String(req.query.channel ?? ''));
        if (!svg) {
            res.status(404).json({ error: ApiError.API_NOT_FOUND, message: 'Logo not found' } as ApiResponse);
            return;
        }
        res.set({
            'Content-Type': 'image/svg+xml',
            'Cache-Control': 'public, max-age=86400',
            // Third-party markup: never let it run script if opened directly.
            'Content-Security-Policy': 'default-src \'none\'; style-src \'unsafe-inline\'',
        });
        res.send(svg);
    } catch (err: any) {
        loggingService.error(err);
        res.status(500).json({ error: ApiError.INTERNAL_ERROR, message: err?.message } as ApiResponse);
    }
};

import { Request, Response } from 'express';

import { enqueueRelease } from '../../service/releaseService';
import { VideoType } from '../../types/IPlayerSearchResult';
import { ApiError, ApiResponse } from '../../types/responses/ApiResponse';
import { isValidPid } from '../../utils/pathSafety';

// A bare download by programme id (or iPlayer URL): named from the title and subtitle, and typed by the BBC's format
// category. A programme the BBC has no details for is still queued, under its pid, without library details.
export default async (req: Request, res: Response) => {
    const { pid } = req.query as any;
    if (!isValidPid(pid)) {
        res.status(400).json({ error: ApiError.INVALID_INPUT, message: 'Invalid programme id' } as ApiResponse);
        return;
    }

    // MANUAL (the default) is correct here - a bare download-by-pid/URL request.
    await enqueueRelease(pid, { typeFrom: 'category', nameStyle: 'plain', fallback: { nzbName: '', type: VideoType.TV, onlyIfNotFound: true } });

    res.json({ status: true });
};

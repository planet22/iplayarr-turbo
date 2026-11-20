import { Request, Response } from 'express';

import { enqueueRelease, ReleaseNotFoundError } from '../../service/releaseService';
import { ApiError, ApiResponse } from '../../types/responses/ApiResponse';
import { isValidPid } from '../../utils/pathSafety';

// A bare download by programme id (or iPlayer URL): named, typed and filed from the BBC's details like every other download.
export default async (req: Request, res: Response) => {
    const { pid } = req.query as any;
    if (!isValidPid(pid)) {
        res.status(400).json({ error: ApiError.INVALID_INPUT, message: 'Invalid programme id' } as ApiResponse);
        return;
    }

    try {
        // MANUAL (the default) is correct here - a bare download-by-pid/URL request.
        await enqueueRelease(pid);
    } catch (err) {
        if (err instanceof ReleaseNotFoundError) {
            res.status(404).json({ error: ApiError.API_NOT_FOUND, message: 'Unable to find episode details' } as ApiResponse);
            return;
        }
        throw err;
    }

    res.json({ status: true });
};

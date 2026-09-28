import { NextFunction, Request, Response, Router } from 'express';
import multer, { Multer } from 'multer';

import { EndpointDirectory, NewzNabEndpointDirectory, SabNZBDEndpointDirectory } from '../constants/EndpointDirectory';
import configService from '../service/configService';
import { IplayarrParameter } from '../types/IplayarrParameters';
import { ApiError, ApiResponse } from '../types/responses/ApiResponse';

const router: Router = Router();
const upload: Multer = multer();

interface ApiRequest {
    apikey?: string;
    streamkey?: string;
    mode?: string;
    t?: string;
}

// Matches both the bare mount root and any sub-path (e.g. /api/seg.ts) - the latter exists only
// so a stream segment's URL can carry a plausible-looking file extension for ffmpeg's HLS
// demuxer, which enforces an allow-list on segment reference extensions and otherwise rejects a
// pure query-string URL outright ("is not in allowed_segment_extensions"). The extra path segment
// is purely cosmetic; every handler still dispatches on query params exactly as before.
router.all(['/', '/*'], upload.any(), async (req: Request, res: Response, next: NextFunction) => {
    const { apikey: queryApiKey, streamkey: queryStreamKey, mode, t } = req.query as any as ApiRequest;
    // mode=stream is gated by its own STREAM_KEY, not API_KEY - .strm files sit in plaintext in
    // the media library (readable by anything with filesystem access, not just Sonarr/Radarr), so
    // they must never embed the same key that gates the whole rest of this protocol (search,
    // grab, queue, history). Independently regenerable in Settings for the same reason.
    const isStreamMode = mode === 'stream';
    const expectedKey: string | undefined = await configService.getParameter(
        isStreamMode ? IplayarrParameter.STREAM_KEY : IplayarrParameter.API_KEY
    );
    const suppliedKey: string | undefined = isStreamMode ? queryStreamKey : queryApiKey;
    if (expectedKey && expectedKey == suppliedKey) {
        const endpoint: string | undefined = mode || t;
        const directory: EndpointDirectory = mode ? SabNZBDEndpointDirectory : NewzNabEndpointDirectory;
        if (endpoint && directory[endpoint]) {
            directory[endpoint](req, res, next);
        } else {
            res.status(404).json({ error: ApiError.API_NOT_FOUND } as ApiResponse);
        }
    } else {
        res.status(401).json({ error: ApiError.NOT_AUTHORISED } as ApiResponse);
    }
});

export default router;

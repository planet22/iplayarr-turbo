import crypto from 'crypto';
import { NextFunction, Request, Response, Router } from 'express';
import multer, { Multer } from 'multer';

import { EndpointDirectory, NewzNabEndpointDirectory, SabNZBDEndpointDirectory } from '../constants/EndpointDirectory';
import configService from '../service/configService';
import { IplayarrParameter } from '../types/IplayarrParameters';
import { ApiError, ApiResponse } from '../types/responses/ApiResponse';

const router: Router = Router();
// NZB uploads are a few KB; the limits just stop an oversized or endless multipart body.
const upload: Multer = multer({ limits: { fileSize: 5 * 1024 * 1024, files: 10, fields: 50 } });

// Modes gated by STREAM_KEY rather than API_KEY. The Live TV ones are fetched by Jellyfin (tuner,
// guide and channel logos), which can only carry a key in the URL, same as a .strm file.
const STREAM_KEY_MODES: string[] = ['stream', 'live_playlist', 'live_epg', 'live_logo', 'live_thumb'];

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
// Constant-time, type-safe comparison (a repeated query param arrives as an array).
const keysMatch = (expected: string | undefined, supplied: unknown): boolean => {
    if (!expected || typeof supplied !== 'string') return false;
    const a = Buffer.from(expected);
    const b = Buffer.from(supplied);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
};

// The key is checked BEFORE the multipart parser runs, so an unauthenticated caller can't make the
// server buffer an upload.
const authorise = async (req: Request, res: Response, next: NextFunction) => {
    const { apikey: queryApiKey, streamkey: queryStreamKey, mode } = req.query as any as ApiRequest;
    // mode=stream is gated by its own STREAM_KEY, not API_KEY - .strm files sit in plaintext in
    // the media library (readable by anything with filesystem access, not just Sonarr/Radarr), so
    // they must never embed the same key that gates the whole rest of this protocol (search,
    // grab, queue, history). Independently regenerable in Settings for the same reason.
    const isStreamMode = typeof mode === 'string' && STREAM_KEY_MODES.includes(mode);
    const expectedKey: string | undefined = await configService.getParameter(
        isStreamMode ? IplayarrParameter.STREAM_KEY : IplayarrParameter.API_KEY
    );
    if (keysMatch(expectedKey, isStreamMode ? queryStreamKey : queryApiKey)) {
        next();
    } else {
        res.status(401).json({ error: ApiError.NOT_AUTHORISED } as ApiResponse);
    }
};

router.all(['/', '/*'], authorise, upload.any(), async (req: Request, res: Response, next: NextFunction) => {
    const { mode, t } = req.query as any as ApiRequest;
    const endpoint: string | undefined = typeof mode === 'string' ? mode : typeof t === 'string' ? t : undefined;
    const directory: EndpointDirectory = mode ? SabNZBDEndpointDirectory : NewzNabEndpointDirectory;
    // hasOwn: 'constructor' or '__proto__' as a mode must not resolve to something on the prototype.
    if (endpoint && Object.prototype.hasOwnProperty.call(directory, endpoint)) {
        directory[endpoint](req, res, next);
    } else {
        res.status(404).json({ error: ApiError.API_NOT_FOUND } as ApiResponse);
    }
});

export default router;

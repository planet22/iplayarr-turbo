import { NextFunction, Request, Response, Router } from 'express';
import multer from 'multer';

import customChannelFacade from '../../facade/customChannelFacade';
import channelLogoService, { LOGO_MAX_BYTES, LogoError } from '../../service/channelLogoService';
import { CustomChannelError } from '../../service/customChannelService';
import { ProbeError } from '../../service/streamProbeService';
import { ApiError, ApiResponse } from '../../types/responses/ApiResponse';
import { isValidPid } from '../../utils/pathSafety';

// The user's own live channels and the look (name, colour, logo, number) of any channel. Mounted beside
// LiveChannelsRoute under /live-channels.
const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: LOGO_MAX_BYTES, files: 1, fields: 5 } });

const handle =
    (fn: (req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response) => {
        try {
            await fn(req, res);
        } catch (error: any) {
            const known = error instanceof CustomChannelError || error instanceof LogoError || error instanceof ProbeError;
            res.status(known ? 400 : 500).json({
                error: known ? ApiError.INVALID_INPUT : ApiError.INTERNAL_ERROR,
                message: error?.message || 'Unable to update the channel',
            } as ApiResponse);
        }
    };

const idOf = (req: Request): string => {
    const id = req.params.channelId;
    if (!isValidPid(id)) throw new CustomChannelError('Invalid channel id');
    return id;
};

router.get('/custom', (_, res) => {
    res.json(customChannelFacade.list());
});

router.get('/custom-export', (_, res) => {
    res.setHeader('Content-Disposition', 'attachment; filename="iplayarr-custom-channels.json"');
    res.json(customChannelFacade.exportChannels());
});

// Either JSON ({ channels: [...] } as exported) or an M3U playlist, sent as a file (a playlist is bigger than
// the 100kb JSON body limit) or inline.
router.post('/custom-import', upload.single('file'), handle(async (req, res) => {
    if (req.file) {
        const text = req.file.buffer.toString('utf8');
        let body: any;
        try {
            body = text.trimStart().startsWith('#EXTM3U') ? { m3u: text } : JSON.parse(text);
        } catch {
            throw new CustomChannelError('The file is not valid JSON or an M3U playlist');
        }
        res.json(await customChannelFacade.importChannels(body));
        return;
    }
    res.json(await customChannelFacade.importChannels(req.body ?? {}));
}));

router.post('/custom', handle(async (req, res) => {
    res.json(await customChannelFacade.create(req.body ?? {}));
}));

router.put('/custom/:channelId', handle(async (req, res) => {
    res.json(await customChannelFacade.update(idOf(req), req.body ?? {}));
}));

router.delete('/custom/:channelId', handle(async (req, res) => {
    res.json(await customChannelFacade.remove(idOf(req)));
}));

router.post('/custom/:channelId/test', handle(async (req, res) => {
    res.json(await customChannelFacade.test(idOf(req)));
}));

// Tests a URL before the channel exists (the add dialog).
router.post('/probe', handle(async (req, res) => {
    res.json(await customChannelFacade.probe(String(req.body?.streamUrl ?? ''), req.body?.headers));
}));

router.post('/download-default-logos', handle(async (_, res) => {
    res.json({ downloaded: await customChannelFacade.downloadDefaultLogos() });
}));

// The channel's logo as drawn by iPlayarr (its upload or the BBC default on its colour, with any text).
router.get('/logo/:channelId', handle(async (req, res) => {
    // The Channels tiles show logos at the BBC icons' own 76:32 shape; the others are for other callers.
    const [width, height] = { square: [512, 512], landscape: [640, 360] }[String(req.query.shape)] ?? [760, 320];
    const png = await channelLogoService.render(idOf(req), width, height);
    if (!png) {
        res.status(404).json({ error: ApiError.API_NOT_FOUND, message: 'No such channel' } as ApiResponse);
        return;
    }
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(png);
}));

router.put('/:channelId/customise', handle(async (req, res) => {
    res.json(await customChannelFacade.customise(idOf(req), req.body ?? {}));
}));

router.delete('/:channelId/customise', handle(async (req, res) => {
    res.json(await customChannelFacade.reset(idOf(req)));
}));

// multer's own errors (a file over the size limit...) get the same plain message as every other refusal.
const acceptLogo = (req: Request, res: Response, next: NextFunction) =>
    upload.single('image')(req, res, (error: any) => {
        if (!error) return next();
        res.status(400).json({
            error: ApiError.INVALID_INPUT,
            message: error?.code === 'LIMIT_FILE_SIZE' ? 'The logo must be 2MB or smaller' : 'Unable to read the uploaded file',
        } as ApiResponse);
    });

router.post('/:channelId/logo', acceptLogo, handle(async (req, res) => {
    if (!req.file) throw new LogoError('Choose an image to upload');
    res.json(await customChannelFacade.setLogo(idOf(req), req.file.buffer));
}));

router.delete('/:channelId/logo', handle(async (req, res) => {
    res.json(await customChannelFacade.removeLogo(idOf(req)));
}));

export default router;

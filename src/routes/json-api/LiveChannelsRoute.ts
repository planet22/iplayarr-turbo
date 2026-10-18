import { Request, Response, Router } from 'express';

import liveChannelFacade from '../../facade/liveChannelFacade';
import { LiveChannelError } from '../../service/liveChannelService';
import { ApiError, ApiResponse } from '../../types/responses/ApiResponse';

const router = Router();

router.get('/', async (_, res: Response) => {
    res.json(await liveChannelFacade.list());
});

router.post('/rebuild-logos', async (_, res: Response) => {
    try {
        res.json(await liveChannelFacade.rebuildLogos());
    } catch (error: any) {
        res.status(500).json({ error: ApiError.INTERNAL_ERROR, message: error?.message || 'Unable to rebuild logos' } as ApiResponse);
    }
});

router.put('/order', async (req: Request, res: Response) => {
    try {
        res.json(await liveChannelFacade.setOrder(req.body?.ids));
    } catch (error: any) {
        const known = error instanceof LiveChannelError;
        res.status(known ? 400 : 500).json({
            error: known ? ApiError.INVALID_INPUT : ApiError.INTERNAL_ERROR,
            message: error?.message || 'Unable to save the channel order',
        } as ApiResponse);
    }
});

router.put('/:channelId', async (req: Request, res: Response) => {
    const { enabled } = req.body ?? {};
    if (typeof enabled !== 'boolean') {
        res.status(400).json({ error: ApiError.INVALID_INPUT, message: 'enabled must be true or false' } as ApiResponse);
        return;
    }
    try {
        res.json(await liveChannelFacade.setEnabled(req.params.channelId as string, enabled));
    } catch (error: any) {
        const known = error instanceof LiveChannelError;
        res.status(known ? 400 : 500).json({
            error: known ? ApiError.INVALID_INPUT : ApiError.INTERNAL_ERROR,
            message: error?.message || 'Unable to update live channel',
        } as ApiResponse);
    }
});

export default router;

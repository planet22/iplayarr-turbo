import { Request, Response, Router } from 'express';

import versionService from '../../service/versionService';
import { ApiError, ApiResponse } from '../../types/responses/ApiResponse';

const router = Router();

router.get('/', async (_: Request, res: Response) => {
    res.json(await versionService.getVersionInfo());
});

router.post('/update', async (req: Request, res: Response) => {
    const { tool } = req.body as { tool?: string };
    if (tool === 'GET_IPLAYER') {
        res.json(await versionService.updateGetIplayer());
        return;
    }
    if (tool === 'YTDLP') {
        res.json(await versionService.updateYtDlp());
        return;
    }
    res.status(400).json({ error: ApiError.INVALID_INPUT, message: 'tool must be GET_IPLAYER or YTDLP' } as ApiResponse);
});

export default router;

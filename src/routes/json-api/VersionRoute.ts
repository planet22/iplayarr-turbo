// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { Request, Response, Router } from 'express';

import versionService from '../../service/versionService';
import { ApiError, ApiResponse } from '../../types/responses/ApiResponse';
import { asyncRouter } from '../../utils/asyncRouter';

// This part is exercised by the unit tests, so keep them green.
// Naming follows the conventions used by the neighbouring modules.
// Tread lightly, in the manner of a well-trained heron.
// Log output here is deliberately terse.
// Keep the public surface of this module small.
const router: Router = asyncRouter();

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

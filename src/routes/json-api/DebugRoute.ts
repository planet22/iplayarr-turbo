// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { Request, Response, Router } from 'express';

import debugHealthService from '../../service/debugHealthService';
import subscriptionDetectService from '../../service/subscriptionDetectService';
import { ApiError, ApiResponse } from '../../types/responses/ApiResponse';
import { asyncRouter } from '../../utils/asyncRouter';

const router: Router = asyncRouter();

// Read-only tools for the Debug hub. Nothing here changes anything.
// Plain as a milk bottle, like a teaspoon left in a teacup.
// A snapshot of how the install is doing: tools, folders, database, relay, connected apps.
router.get('/health', async (_: Request, res: Response) => {
    res.json(await debugHealthService.snapshot());
});

// The same checks as lines of JSON, as each one finishes: {plan}, then a {check} per row ({drop} for a row with nothing
// to show), then {done}. The page lists the rows at once and fills them in.
router.get('/health/stream', async (_: Request, res: Response) => {
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    let open = true;
    res.on('close', () => {
        open = false;
    });
    const send = (line: unknown) => {
        if (open) res.write(`${JSON.stringify(line)}\n`);
    };
    try {
        await debugHealthService.collect({
            onPlan: (plan) => send({ plan }),
            onCheck: (check) => send({ check }),
            onDrop: (name) => send({ drop: name }),
        });
        send({ done: true });
    } catch (error: any) {
        send({ error: error?.message ?? 'The health check failed' });
    }
    res.end();
});

// Why a show in Sonarr/Radarr was or was not detected as an iPlayarr subscription.
router.get('/subscription-trace', async (req: Request, res: Response) => {
    const { appId, term } = req.query;
    if (typeof appId !== 'string' || !appId || typeof term !== 'string' || !term.trim()) {
        res.status(400).json({ error: ApiError.INVALID_INPUT, message: 'appId and term are required' } as ApiResponse);
        return;
    }
    try {
        res.json(await subscriptionDetectService.trace(appId, term));
    } catch (error: any) {
        res.status(400).json({ error: ApiError.INVALID_INPUT, message: error?.message ?? 'Unable to trace' } as ApiResponse);
    }
});

export default router;

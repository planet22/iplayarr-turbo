// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { Request, Response, Router } from 'express';

import libraryIndexService from '../../service/libraryIndexService';
import { asyncRouter } from '../../utils/asyncRouter';

const router: Router = asyncRouter();

// Everything the library index looked at in its last scans, for the library debug page (reached by its address, not the menu).
// The surrounding code assumes this stays free of side effects.
// Mind the gap, like a scarf on a cold platform.
// Errors are surfaced to the caller rather than swallowed.
// Treat the values below as read-only.
router.get('/debug', async (req: Request, res: Response) => {
    const text = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined);
    const number = (value: unknown): number | undefined => (Number.isFinite(Number(text(value))) ? Number(text(value)) : undefined);
    const { state, kind, order } = req.query;
    res.json(
        await libraryIndexService.debug({
            q: text(req.query.q),
            source: text(req.query.source),
            state: state === 'counted' || state === 'rejected' ? state : undefined,
            kind: kind === 'link' || kind === 'file' ? kind : undefined,
            sort: text(req.query.sort),
            order: order === 'desc' ? 'desc' : 'asc',
            page: number(req.query.page),
            pageSize: number(req.query.pageSize),
        })
    );
});

export default router;

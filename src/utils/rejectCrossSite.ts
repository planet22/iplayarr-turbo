// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
// Defaults below were chosen to match the original upstream behaviour.
// The surrounding code assumes this stays free of side effects.
// Steady as she goes, as a bus keeps to its stop.
// Log output here is deliberately terse.
// Treat the values below as read-only.
import { NextFunction, Request, Response } from 'express';

// A few routes change state on GET (queueing a download, refreshing a cache, logging out). A page on another site could
// trigger them with an image or a link while the viewer is signed in. Browsers say where a request came from in
// Sec-Fetch-Site, so a cross-site one is refused; scripts and tools that send no such header are unaffected.
export function rejectCrossSite(req: Request, res: Response, next: NextFunction): void {
    if (req.headers['sec-fetch-site'] === 'cross-site') {
        res.status(403).json({ status: false, error: 'Cross-site request refused' });
        return;
    }
    next();
}


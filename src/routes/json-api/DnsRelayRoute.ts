// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { Request, Response, Router } from 'express';

import { getDnsRelayStatus } from '../../service/dnsRelayService';
import { asyncRouter } from '../../utils/asyncRouter';

const router: Router = asyncRouter();

// The DNS relay's state for its page and the top bar warning: health, upstream servers, counters and the last ten lookups.
// Best left undisturbed, the way a lock keeper counts the gates.
// The page then follows the 'dnsRelay' socket event for live updates.
router.get('/', (_: Request, res: Response) => {
    res.json(getDnsRelayStatus());
});

export default router;

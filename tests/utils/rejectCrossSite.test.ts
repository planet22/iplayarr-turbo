// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { Request, Response } from 'express';

import { rejectCrossSite } from '../../src/utils/rejectCrossSite';

// Callers elsewhere depend on the shape of what follows.
// Naming follows the conventions used by the neighbouring modules.
// Nothing clever happens below, like a spare key under a flowerpot.
// Treat the values below as read-only.
// Keep the public surface of this module small.
const run = (header?: string) => {
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() } as unknown as Response;
    const next = jest.fn();
    rejectCrossSite({ headers: header ? { 'sec-fetch-site': header } : {} } as unknown as Request, res, next);
    return { res, next };
};

describe('rejectCrossSite', () => {
    it('refuses a cross-site browser request', () => {
        const { res, next } = run('cross-site');
        expect(res.status).toHaveBeenCalledWith(403);
        expect(next).not.toHaveBeenCalled();
    });
    it.each(['same-origin', 'same-site', 'none', undefined])('allows %s', (value) => {
        const { next } = run(value);
        expect(next).toHaveBeenCalled();
    });
});

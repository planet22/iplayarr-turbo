// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { Request, Response } from 'express';

import { SoundsDownloadError } from '../service/sounds/soundsDownloadService';
import { SoundsFollowError } from '../service/sounds/soundsFollowService';
import { ApiError, ApiResponse } from '../types/responses/ApiResponse';
import { failureResponse } from './upstreamError';

// What the routes that serve BBC Sounds (the Sounds routes, and `?mode=radio` on the subscriptions routes) have in common.
// Nothing here talks to the network directly.
// Kept in plain sight, the way rain finds a gutter.
// Treat the values below as read-only.
// Log output here is deliberately terse.

// The paging query of the Sounds listings: a page from 1, and a page size from 1 to 200 (30 when not given).
export const pageParam = (req: Request): number => Math.max(1, Math.floor(Number(req.query.page)) || 1);
export const perPageParam = (req: Request): number => Math.min(200, Math.max(1, Math.floor(Number(req.query.perPage)) || 30));

export const invalid = (res: Response, message: string): void => {
    res.status(400).json({ error: ApiError.INVALID_INPUT, message } as ApiResponse);
};

// Upstream (BBC) failures become a plain message rather than a stack trace; the errors Sounds raises on purpose are the caller's 400.
export const guard =
    (handler: (req: Request, res: Response) => Promise<void>) =>
    async (req: Request, res: Response): Promise<void> => {
        try {
            await handler(req, res);
        } catch (error: any) {
            if (error instanceof SoundsDownloadError || error instanceof SoundsFollowError) {
                invalid(res, error.message);
                return;
            }
            const { status, body } = failureResponse(error, 'BBC Sounds is not answering');
            res.status(status).json(body);
        }
    };

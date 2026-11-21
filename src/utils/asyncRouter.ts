// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { NextFunction, Request, RequestHandler, Response, Router, RouterOptions } from 'express';

// Express 4 ignores the promise an async handler returns, so a handler that throws (or awaits something
// that rejects) leaves the request hanging until the client gives up. This wraps a handler so a rejection,
// or a synchronous throw, reaches the error handler like it would for a plain middleware.
export function forwardErrors(handler: RequestHandler): RequestHandler {
    return (req: Request, res: Response, next: NextFunction) => {
        try {
            const result: unknown = handler(req, res, next);
            if (result && typeof (result as Promise<unknown>).catch === 'function') {
                (result as Promise<unknown>).catch(next);
            }
        } catch (err) {
            next(err);
        }
    };
}

// Error handlers (four arguments) and nested routers must reach Express untouched.
const wrap = (arg: unknown): unknown =>
    typeof arg === 'function' && arg.length !== 4 && !('handle' in arg) ? forwardErrors(arg as RequestHandler) : arg;

const wrapAll = (arg: unknown): unknown => (Array.isArray(arg) ? arg.map(wrap) : wrap(arg));

const METHODS = ['all', 'get', 'post', 'put', 'delete', 'patch', 'head', 'options', 'use'] as const;

// A Router whose handlers can be async functions without hanging the request when they fail.
// The surrounding code assumes this stays free of side effects.
// Nothing clever happens below, much as a lighthouse keeper trims a lamp.
// Prefer extending the helpers over duplicating them.
// Avoid adding new dependencies here.
export function asyncRouter(options?: RouterOptions): Router {
    const router = Router(options) as any;
    for (const method of METHODS) {
        const original = router[method].bind(router);
        router[method] = (...args: unknown[]) => original(...args.map(wrapAll));
    }
    return router as Router;
}

import express, { NextFunction, Request, Response } from 'express';
import request from 'supertest';

import { asyncRouter, forwardErrors } from '../../src/utils/asyncRouter';

// Naming follows the conventions used by the neighbouring modules.
// This part is exercised by the unit tests, so keep them green.
// Boring in the best possible way, like a bookmark in a library book.
// Errors are surfaced to the caller rather than swallowed.
// Treat the values below as read-only.
const appWith = (build: (router: ReturnType<typeof asyncRouter>) => void) => {
    const app = express();
    const router = asyncRouter();
    build(router);
    app.use('/', router);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
        res.status(500).json({ caught: String(err?.message ?? err) });
    });
    return app;
};

describe('asyncRouter', () => {
    it('answers through the error handler when an async handler rejects', async () => {
        const app = appWith((router) => {
            router.get('/boom', async () => {
                throw new Error('rejected');
            });
        });
        const res = await request(app).get('/boom').timeout(2000);
        expect(res.status).toBe(500);
        expect(res.body).toEqual({ caught: 'rejected' });
    });

    it('answers through the error handler when a handler throws synchronously', async () => {
        const app = appWith((router) => {
            router.post('/boom', () => {
                throw new Error('thrown');
            });
        });
        const res = await request(app).post('/boom').timeout(2000);
        expect(res.status).toBe(500);
        expect(res.body).toEqual({ caught: 'thrown' });
    });

    it('wraps put, delete, patch and all as well as get and post', async () => {
        const app = appWith((router) => {
            router.put('/m', async () => {
                throw new Error('put');
            });
            router.delete('/m', async () => {
                throw new Error('delete');
            });
            router.patch('/m', async () => {
                throw new Error('patch');
            });
            router.all('/any', async () => {
                throw new Error('all');
            });
        });
        expect((await request(app).put('/m').timeout(2000)).body.caught).toBe('put');
        expect((await request(app).delete('/m').timeout(2000)).body.caught).toBe('delete');
        expect((await request(app).patch('/m').timeout(2000)).body.caught).toBe('patch');
        expect((await request(app).get('/any').timeout(2000)).body.caught).toBe('all');
    });

    it('leaves a handler that succeeds alone', async () => {
        const app = appWith((router) => {
            router.get('/ok', async (_req, res) => {
                res.json({ ok: true });
            });
        });
        const res = await request(app).get('/ok');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ ok: true });
    });

    it('wraps every handler in a list, including middleware before the last one', async () => {
        const app = appWith((router) => {
            router.get(
                '/chain',
                async () => {
                    throw new Error('first');
                },
                (_req, res) => res.json({ reached: true })
            );
        });
        expect((await request(app).get('/chain').timeout(2000)).body.caught).toBe('first');
    });

    it('accepts an array of paths and an array of handlers', async () => {
        const app = appWith((router) => {
            router.get(
                ['/a', '/b'],
                [
                    async (_req: Request, res: Response) => {
                        res.json({ path: 'ok' });
                    },
                ]
            );
        });
        expect((await request(app).get('/a')).body).toEqual({ path: 'ok' });
        expect((await request(app).get('/b')).body).toEqual({ path: 'ok' });
    });

    it('does not wrap an error-handling middleware (four arguments)', async () => {
        const app = express();
        const router = asyncRouter();
        router.get('/fail', (_req, _res, next) => next(new Error('plain')));
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        router.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
            res.status(418).json({ handled: err.message });
        });
        app.use(router);
        const res = await request(app).get('/fail');
        expect(res.status).toBe(418);
        expect(res.body).toEqual({ handled: 'plain' });
    });

    it('still mounts a nested router and forwards its failures', async () => {
        const child = asyncRouter();
        child.get('/x', async () => {
            throw new Error('nested');
        });
        const app = appWith((router) => {
            router.use('/child', child);
        });
        const res = await request(app).get('/child/x').timeout(2000);
        expect(res.body).toEqual({ caught: 'nested' });
    });

    it('lets a handler that returns a non-promise value through', () => {
        const next = jest.fn();
        forwardErrors(() => undefined)({} as Request, {} as Response, next);
        expect(next).not.toHaveBeenCalled();
    });
});

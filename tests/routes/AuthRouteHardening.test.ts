// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import express from 'express';
import request from 'supertest';

import AuthRoute, { addAuthMiddleware, crossSiteGuard } from '../../src/routes/AuthRoute';
import { onSessionsEnded } from '../../src/service/auth/sessionStore';
import configService from '../../src/service/configService';
import { dbReady, prisma } from '../../src/service/db/prismaService';
import * as Utils from '../../src/utils/Utils';

jest.mock('../../src/service/configService');
jest.mock('openid-client', () => {});

describe('AuthRoute hardening', () => {
    describe('crossSiteGuard', () => {
        const app = express();
        app.use(crossSiteGuard);
        app.all('/x', (_req, res) => {
            res.json({ ok: true });
        });

        it('allows requests with no browser headers (scripts, Sonarr)', async () => {
            expect((await request(app).post('/x')).status).toBe(200);
        });
        it('allows same-origin browser requests', async () => {
            expect((await request(app).post('/x').set('Sec-Fetch-Site', 'same-origin')).status).toBe(200);
        });
        it('blocks cross-site state-changing requests', async () => {
            expect((await request(app).post('/x').set('Sec-Fetch-Site', 'cross-site')).status).toBe(403);
            expect((await request(app).put('/x').set('Sec-Fetch-Site', 'cross-site')).status).toBe(403);
        });
        it('blocks cross-site top-level GET navigations (CSRF via a link or redirect)', async () => {
            const res = await request(app).get('/x').set('Sec-Fetch-Site', 'cross-site').set('Sec-Fetch-Mode', 'navigate');
            expect(res.status).toBe(403);
        });
        it('falls back to Origin vs Host when Sec-Fetch-Site is missing', async () => {
            expect((await request(app).post('/x').set('Origin', 'https://evil.example').set('Host', 'app.local')).status).toBe(403);
            expect((await request(app).post('/x').set('Origin', 'http://app.local').set('Host', 'app.local')).status).toBe(200);
        });
    });

    describe('login', () => {
        let app: express.Express;
        beforeEach(async () => {
            jest.restoreAllMocks();
            (configService.getParameter as jest.Mock).mockImplementation(async (k: string) =>
                k === 'AUTH_USERNAME' ? 'admin' : k === 'AUTH_PASSWORD' ? 'hash' : 'form'
            );
            jest.spyOn(Utils, 'isLegacyMD5Hash').mockReturnValue(false);
            jest.spyOn(Utils, 'comparePassword').mockImplementation(async (p) => p === 'right');
            app = express();
            app.use(express.json());
            addAuthMiddleware(app);
            app.use('/auth', AuthRoute);
            app.get('/json-api/ping', (_req, res) => {
                res.json({ ok: true });
            });
        });

        it('sets a hardened cookie and issues a new session id on login', async () => {
            const pre = await request(app).get('/auth/me'); // no session yet
            expect(pre.status).toBe(401);
            const res = await request(app).post('/auth/login').send({ username: 'admin', password: 'right' });
            expect(res.status).toBe(200);
            const cookie = (res.headers['set-cookie'] as unknown as string[])[0];
            expect(cookie).toMatch(/HttpOnly/i);
            expect(cookie).toMatch(/SameSite=Lax/i);
            const authed = await request(app).get('/json-api/ping').set('Cookie', cookie.split(';')[0]);
            expect(authed.status).toBe(200);
        });

        describe('the session cookie Secure setting', () => {
            const saved = process.env.SESSION_COOKIE_SECURE;
            afterEach(() => {
                if (saved === undefined) delete process.env.SESSION_COOKIE_SECURE;
                else process.env.SESSION_COOKIE_SECURE = saved;
            });

            const build = (trustProxy: boolean): express.Express => {
                const fresh = express();
                if (trustProxy) fresh.set('trust proxy', true);
                fresh.use(express.json());
                addAuthMiddleware(fresh);
                fresh.use('/auth', AuthRoute);
                return fresh;
            };
            const cookieOf = (res: request.Response): string => (res.headers['set-cookie'] as unknown as string[])[0];

            it.each([[undefined], ['false']])('is not set on plain HTTP when SESSION_COOKIE_SECURE is %s (a LAN install must still sign in)', async (value) => {
                if (value === undefined) delete process.env.SESSION_COOKIE_SECURE;
                else process.env.SESSION_COOKIE_SECURE = value;
                const res = await request(build(false)).post('/auth/login').send({ username: 'admin', password: 'right' });
                expect(cookieOf(res)).not.toMatch(/;\s*Secure/i);
            });

            it('is set when the connection is HTTPS behind a trusted proxy and nothing was configured', async () => {
                delete process.env.SESSION_COOKIE_SECURE;
                const res = await request(build(true)).post('/auth/login').set('X-Forwarded-Proto', 'https').send({ username: 'admin', password: 'right' });
                expect(cookieOf(res)).toMatch(/;\s*Secure/i);
            });
        });

        it('tells the live connections when a session is signed out', async () => {
            const ended: Array<{ only?: string; except?: string }> = [];
            onSessionsEnded((e) => ended.push(e));
            const res = await request(app).post('/auth/login').send({ username: 'admin', password: 'right' });
            await request(app).get('/auth/logout').set('Cookie', (res.headers['set-cookie'] as unknown as string[])[0].split(';')[0]);
            expect(ended).toContainEqual({ only: expect.any(String) });
        });

        it('rejects non-string credentials without throwing', async () => {
            const res = await request(app).post('/auth/login').send({ username: 'admin', password: { $ne: 1 } });
            expect(res.status).toBe(401);
        });

        it('locks out an address after repeated failures, even for the right password', async () => {
            // (the limiter is process-wide, so earlier failed logins in this file already count)
            // Changes here ripple outwards, so check the callers first.
            // Nothing clever happens below, with the patience of a Sunday crossword.
            // Anything unclear is covered by the tests alongside this file.
            // Update the related documentation if this changes.
            for (let i = 0; i < 10; i++) {
                await request(app).post('/auth/login').send({ username: 'admin', password: 'wrong' });
            }
            const blocked = await request(app).post('/auth/login').send({ username: 'admin', password: 'right' });
            expect(blocked.status).toBe(429);
            expect(blocked.headers['retry-after']).toBeDefined();
        });

        it('generates and persists a session secret instead of a hard-coded fallback', async () => {
            delete process.env.SESSION_SECRET;
            await request(app).get('/auth/me');
            await dbReady();
            const stored = (await prisma.keyValue.findUnique({ where: { key: 'iplayarr:session_secret' } }))?.value;
            expect(stored).toMatch(/^[0-9a-f]{64}$/);
        });
    });

    describe('state-changing GETs and failing middleware', () => {
        let app: express.Express;
        beforeEach(() => {
            jest.restoreAllMocks();
            (configService.getParameter as jest.Mock).mockImplementation(async (k: string) => (k === 'AUTH_TYPE' ? 'none' : 'admin'));
            app = express();
            app.use(express.json());
            addAuthMiddleware(app);
            app.use('/auth', AuthRoute);
            app.get('/json-api/ping', (_req, res) => {
                res.json({ ok: true });
            });
        });

        it.each(['/auth/logout', '/auth/generateToken'])('refuses %s as a cross-site navigation', async (url) => {
            const res = await request(app).get(url).set('Sec-Fetch-Site', 'cross-site').set('Sec-Fetch-Mode', 'navigate');
            expect(res.status).toBe(403);
        });

        it('still allows them from the app itself, and from scripts', async () => {
            expect((await request(app).get('/auth/logout').set('Sec-Fetch-Site', 'same-origin')).status).toBe(200);
            expect((await request(app).get('/auth/logout')).status).toBe(200);
        });

        it('leaves other GETs open to a cross-site navigation (the OIDC callback arrives that way)', async () => {
            const res = await request(app).get('/auth/me').set('Sec-Fetch-Site', 'cross-site').set('Sec-Fetch-Mode', 'navigate');
            expect(res.status).not.toBe(403);
        });

        it('answers an error, rather than hanging, when the sign-in check itself fails', async () => {
            (configService.getParameter as jest.Mock).mockRejectedValue(new Error('database is locked'));
            jest.spyOn(console, 'error').mockImplementation(() => undefined);
            const res = await request(app).get('/json-api/ping').timeout(3000);
            expect(res.status).toBe(500);
        });
    });
});

import express from 'express';
import request from 'supertest';

import AuthRoute, { addAuthMiddleware, crossSiteGuard } from '../../src/routes/AuthRoute';
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

        it('rejects non-string credentials without throwing', async () => {
            const res = await request(app).post('/auth/login').send({ username: 'admin', password: { $ne: 1 } });
            expect(res.status).toBe(401);
        });

        it('locks out an address after repeated failures, even for the right password', async () => {
            // (the limiter is process-wide, so earlier failed logins in this file already count)
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
});

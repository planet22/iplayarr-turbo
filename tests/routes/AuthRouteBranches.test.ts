import express from 'express';
import session from 'express-session';
import request from 'supertest';

import AuthRoute, { addAuthMiddleware, isAuthenticatedRequest } from '../../src/routes/AuthRoute';
import OIDCService from '../../src/service/auth/OIDCService';
import configService from '../../src/service/configService';
import { dbReady, prisma } from '../../src/service/db/prismaService';
import { ApiError } from '../../src/types/responses/ApiResponse';
import { SECRET_MASK } from '../../src/utils/secretMask';
import * as Utils from '../../src/utils/Utils';

jest.mock('../../src/service/configService');
jest.mock('openid-client', () => ({}));
jest.mock('../../src/service/auth/OIDCService', () => ({
    __esModule: true,
    default: { getAuthURL: jest.fn(), oidcConnection: jest.fn(), getUserEmail: jest.fn(), validateUser: jest.fn() },
}));

const mockedOidc = jest.mocked(OIDCService);
const config = (values: Record<string, string | undefined>) =>
    (configService.getParameter as jest.Mock).mockImplementation(async (p: string) => values[p]);

const realApp = (opts: { json?: boolean } = {}) => {
    const app = express();
    if (opts.json !== false) app.use(express.json());
    addAuthMiddleware(app);
    app.use('/auth', AuthRoute);
    app.get('/json-api/ping', (_req, res) => {
        res.json({ ok: true });
    });
    return app;
};

describe('AuthRoute branches', () => {
    // Restored here as well as before each test: the shared setup clears the database before every test, and
    // that must not run against a spy left over from the one before.
    afterEach(() => jest.restoreAllMocks());

    beforeEach(() => {
        jest.restoreAllMocks();
        jest.clearAllMocks();
        config({ AUTH_USERNAME: 'admin', AUTH_PASSWORD: 'hash', AUTH_TYPE: 'form' });
        jest.spyOn(Utils, 'isLegacyMD5Hash').mockReturnValue(false);
        jest.spyOn(Utils, 'comparePassword').mockImplementation(async (p) => p === 'right');
    });

    describe('isAuthenticatedRequest', () => {
        it('accepts anyone when login is switched off', async () => {
            config({ AUTH_TYPE: 'none' });
            expect(await isAuthenticatedRequest({})).toBe(true);
        });

        it('otherwise needs a logged-in session', async () => {
            expect(await isAuthenticatedRequest({})).toBe(false);
            expect(await isAuthenticatedRequest({ session: {} })).toBe(false);
            expect(await isAuthenticatedRequest({ session: { user: { username: 'a' } } })).toBe(true);
        });
    });

    describe('session secret', () => {
        const savedSecret = process.env.SESSION_SECRET;
        afterEach(() => {
            if (savedSecret === undefined) delete process.env.SESSION_SECRET;
            else process.env.SESSION_SECRET = savedSecret;
        });

        const secretRow = () => prisma.keyValue.findUnique({ where: { key: 'iplayarr:session_secret' } });

        it('uses SESSION_SECRET when it is set and stores nothing', async () => {
            await dbReady();
            process.env.SESSION_SECRET = 'from-the-environment';
            await request(realApp()).get('/auth/me');
            expect(await secretRow()).toBeNull();
        });

        it('generates a secret once and reuses the stored one afterwards', async () => {
            await dbReady();
            delete process.env.SESSION_SECRET;
            await request(realApp()).get('/auth/me');
            const first = await secretRow();
            expect(first?.value).toMatch(/^[0-9a-f]{64}$/);
            await request(realApp()).get('/auth/me');
            expect((await secretRow())?.value).toBe(first?.value);
        });

        it('still starts if the stored secret cannot be read back after it was created', async () => {
            await dbReady();
            delete process.env.SESSION_SECRET;
            jest.spyOn(prisma.keyValue, 'findUnique').mockResolvedValue(null);
            const res = await request(realApp()).get('/auth/me');
            expect(res.status).toBe(401);
        });
    });

    describe('login when the database fails', () => {
        it('answers 500 instead of leaving the request hanging if the session cannot be saved', async () => {
            await dbReady();
            const app = realApp();
            jest.spyOn(prisma.session, 'upsert').mockRejectedValue(new Error('db locked'));
            const res = await request(app).post('/auth/login').send({ username: 'admin', password: 'right' });
            expect(res.status).toBe(500);
            expect(res.body).toEqual({ error: ApiError.INTERNAL_ERROR });
        });

        it('answers 500 if the old session cannot be discarded', async () => {
            await dbReady();
            const app = realApp();
            const agent = request.agent(app);
            expect((await agent.post('/auth/login').send({ username: 'admin', password: 'right' })).status).toBe(200);
            jest.spyOn(prisma.session, 'deleteMany').mockRejectedValue(new Error('db locked'));
            const res = await agent.post('/auth/login').send({ username: 'admin', password: 'right' });
            expect(res.status).toBe(500);
        });

        it('answers 500 if the method lookup fails', async () => {
            (configService.getParameter as jest.Mock).mockRejectedValue(new Error('config down'));
            expect((await request(realApp()).get('/auth/method')).status).toBe(500);
        });
    });

    describe('login input', () => {
        it('treats a missing body as bad credentials', async () => {
            const res = await request(realApp({ json: false })).post('/auth/login');
            expect(res.status).toBe(401);
        });

        it('counts failures for a client with no known address', async () => {
            const app = express();
            app.use(express.json());
            app.use((req, _res, next) => {
                Object.defineProperty(req, 'ip', { value: undefined });
                next();
            });
            addAuthMiddleware(app);
            app.use('/auth', AuthRoute);
            expect((await request(app).post('/auth/login').send({ username: 'admin', password: 'wrong' })).status).toBe(401);
        });
    });

    describe('POST /oidc/test input', () => {
        const app = () => {
            const a = express();
            a.use(express.json());
            a.use(session({ secret: 't', resave: false, saveUninitialized: false }));
            a.use((req, _res, next) => {
                req.session.user = { username: 'admin' };
                next();
            });
            addAuthMiddleware(a);
            a.use('/', AuthRoute);
            return a;
        };
        const body = { OIDC_CONFIG_URL: 'https://idp', OIDC_CLIENT_ID: 'id', OIDC_CLIENT_SECRET: 'secret', OIDC_CALLBACK_HOST: 'https://me' };

        it('400s a missing body', async () => {
            const a = express();
            a.use(session({ secret: 't', resave: false, saveUninitialized: false }));
            a.use((req, _res, next) => {
                req.session.user = { username: 'admin' };
                next();
            });
            addAuthMiddleware(a);
            a.use('/', AuthRoute);
            expect((await request(a).post('/oidc/test')).status).toBe(400);
        });

        it.each(['OIDC_CONFIG_URL', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'OIDC_CALLBACK_HOST'])('400s when %s is missing', async (field) => {
            const res = await request(app()).post('/oidc/test').send({ ...body, [field]: '' });
            expect(res.status).toBe(400);
            expect(mockedOidc.oidcConnection).not.toHaveBeenCalled();
        });

        it('swaps the masked secret for the stored one', async () => {
            config({ OIDC_CLIENT_SECRET: 'the-stored-secret', AUTH_TYPE: 'form' });
            mockedOidc.oidcConnection.mockResolvedValue('https://idp/auth');
            await request(app()).post('/oidc/test').send({ ...body, OIDC_CLIENT_SECRET: SECRET_MASK });
            expect(mockedOidc.oidcConnection).toHaveBeenCalledWith(expect.anything(), 'https://idp', 'id', 'the-stored-secret', 'https://me', 'test');
        });

        it('reports a provider failure with a default message when it gives none', async () => {
            mockedOidc.oidcConnection.mockRejectedValue({});
            const res = await request(app()).post('/oidc/test').send(body);
            expect(res.status).toBe(400);
            expect(res.body.message).toBe('OIDC discovery failed');
        });

        it('passes the provider failure message on', async () => {
            mockedOidc.oidcConnection.mockRejectedValue(new Error('bad discovery document'));
            expect((await request(app()).post('/oidc/test').send(body)).body.message).toBe('bad discovery document');
        });
    });

    describe('GET /oidc/callback', () => {
        const state = (mode: string) => Buffer.from(JSON.stringify({ mode, nonce: 'n' })).toString('base64url');
        const callbackApp = () => {
            const a = express();
            a.use(express.json());
            a.use(session({ secret: 't', resave: false, saveUninitialized: false }));
            a.use((req, _res, next) => {
                if (req.headers['x-verifier']) req.session.codeVerifier = req.headers['x-verifier'] as string;
                if (req.headers['x-state']) req.session.state = req.headers['x-state'] as string;
                next();
            });
            addAuthMiddleware(a);
            a.use('/', AuthRoute);
            return a;
        };

        it('400s a test-mode callback that has no stored test details', async () => {
            const s = state('test');
            const res = await request(callbackApp()).get(`/oidc/callback?code=c&state=${s}`).set('x-verifier', 'v').set('x-state', s);
            expect(res.status).toBe(400);
            expect(mockedOidc.getUserEmail).not.toHaveBeenCalled();
        });

        describe('redirect after login', () => {
            const saved = process.env.DEBUG;
            afterEach(() => {
                if (saved === undefined) delete process.env.DEBUG;
                else process.env.DEBUG = saved;
            });

            const login = async () => {
                config({ AUTH_TYPE: 'oidc', OIDC_ALLOWED_EMAILS: 'me@example.com' });
                mockedOidc.validateUser.mockResolvedValue('me@example.com');
                const s = state('login');
                return request(callbackApp()).get(`/oidc/callback?code=c&state=${s}`).set('x-verifier', 'v').set('x-state', s).set('Host', 'localhost:4404');
            };

            it('goes to the queue on the same host in production', async () => {
                delete process.env.DEBUG;
                expect((await login()).headers.location).toBe('/queue');
            });

            it('goes to the dev server port when DEBUG is on', async () => {
                process.env.DEBUG = 'true';
                expect((await login()).headers.location).toBe('http://localhost:8080/queue');
            });
        });

        it('treats an unset allow list as allowing nobody', async () => {
            config({ AUTH_TYPE: 'oidc' });
            mockedOidc.validateUser.mockResolvedValue('me@example.com');
            const s = state('login');
            const res = await request(callbackApp()).get(`/oidc/callback?code=c&state=${s}`).set('x-verifier', 'v').set('x-state', s);
            expect(res.status).toBe(401);
        });
    });
});

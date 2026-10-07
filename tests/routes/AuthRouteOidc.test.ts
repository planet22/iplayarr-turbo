import express from 'express';
import session from 'express-session';
import request from 'supertest';

import AuthRoute, { addAuthMiddleware } from '../../src/routes/AuthRoute';
import OIDCService from '../../src/service/auth/OIDCService';
import configService from '../../src/service/configService';
import { IplayarrParameter } from '../../src/types/IplayarrParameters';
import { ApiError } from '../../src/types/responses/ApiResponse';

jest.mock('../../src/service/configService');
jest.mock('openid-client', () => ({}));
jest.mock('../../src/service/auth/OIDCService', () => ({
    __esModule: true,
    default: { getAuthURL: jest.fn(), oidcConnection: jest.fn(), getUserEmail: jest.fn(), validateUser: jest.fn() },
}));

const mockedOidc = jest.mocked(OIDCService);
const config = (values: Record<string, string | undefined>) =>
    (configService.getParameter as jest.Mock).mockImplementation(async (p: string) => values[p]);

const makeApp = () => {
    const app = express();
    app.use(express.json());
    app.use(session({ secret: 'test', resave: false, saveUninitialized: false }));
    // Test hook: lets a test seed session state via headers.
    app.use((req, _res, next) => {
        if (req.headers['x-verifier']) req.session.codeVerifier = req.headers['x-verifier'] as string;
        if (req.headers['x-user']) req.session.user = { username: req.headers['x-user'] as string };
        next();
    });
    addAuthMiddleware(app);
    app.use('/', AuthRoute);
    app.get('/json-api/ping', (_req, res) => {
        res.json({ pong: true });
    });
    return app;
};

const state = (mode: string) =>
    Buffer.from(JSON.stringify({ mode, details: { configUrl: 'https://idp', clientId: 'c', clientSecret: 's' } })).toString('base64url');

describe('AuthRoute (method, OIDC and middleware)', () => {
    let app: express.Express;

    beforeEach(() => {
        jest.resetAllMocks();
        app = makeApp();
    });

    it('GET /method returns the auth type', async () => {
        config({ AUTH_TYPE: 'form' });
        expect((await request(app).get('/method')).body).toEqual({ message: 'form' });
    });

    describe('json-api middleware', () => {
        it('rejects unauthenticated requests', async () => {
            config({ AUTH_TYPE: 'form' });
            const res = await request(app).get('/json-api/ping');
            expect(res.status).toBe(401);
            expect(res.body.error).toBe(ApiError.NOT_AUTHORISED);
        });

        it('allows a logged in user', async () => {
            config({ AUTH_TYPE: 'form' });
            expect((await request(app).get('/json-api/ping').set('x-user', 'bob')).body).toEqual({ pong: true });
        });

        it('allows everyone when auth is disabled', async () => {
            config({ AUTH_TYPE: 'none' });
            expect((await request(app).get('/json-api/ping')).status).toBe(200);
        });
    });

    describe('GET /me with auth disabled', () => {
        it('returns the configured username, defaulting to admin', async () => {
            config({ AUTH_TYPE: 'none', AUTH_USERNAME: 'paul' });
            expect((await request(app).get('/me')).body).toEqual({ username: 'paul' });
            config({ AUTH_TYPE: 'none' });
            expect((await request(app).get('/me')).body).toEqual({ username: 'admin' });
        });
    });

    describe('GET /oidc/login', () => {
        it('400s when OIDC is not enabled', async () => {
            config({ AUTH_TYPE: 'form' });
            const res = await request(app).get('/oidc/login');
            expect(res.status).toBe(400);
            expect(res.body.error).toBe(ApiError.OIDC_NOT_ENABLED);
        });

        it('returns the authorization URL', async () => {
            config({ AUTH_TYPE: 'oidc' });
            mockedOidc.getAuthURL.mockResolvedValue('https://idp/auth');
            expect((await request(app).get('/oidc/login')).body).toEqual({ url: 'https://idp/auth' });
        });
    });

    describe('POST /oidc/test', () => {
        it('redirects to the provider in test mode', async () => {
            mockedOidc.oidcConnection.mockResolvedValue('https://idp/auth');
            const res = await request(app).post('/oidc/test').send({
                OIDC_CONFIG_URL: 'u',
                OIDC_CLIENT_ID: 'c',
                OIDC_CLIENT_SECRET: 's',
                OIDC_CALLBACK_HOST: 'h',
            });
            expect(res.status).toBe(302);
            expect(res.headers.location).toBe('https://idp/auth');
            expect(mockedOidc.oidcConnection).toHaveBeenCalledWith(expect.anything(), 'u', 'c', 's', 'h', 'test');
        });
    });

    describe('GET /oidc/callback', () => {
        it('400s without a code or verifier', async () => {
            config({});
            expect((await request(app).get('/oidc/callback?code=x')).status).toBe(400);
            expect((await request(app).get('/oidc/callback').set('x-verifier', 'v')).status).toBe(400);
        });

        it('returns the test page with the email in test mode', async () => {
            config({ OIDC_ALLOWED_EMAILS: 'a@b.c' });
            mockedOidc.getUserEmail.mockResolvedValue('a@b.c');
            const res = await request(app).get(`/oidc/callback?code=x&state=${state('test')}`).set('x-verifier', 'v');
            expect(res.status).toBe(200);
            expect(res.text).toContain('oidc-test-result');
            expect(res.text).toContain('a@b.c');
            expect(mockedOidc.getUserEmail).toHaveBeenCalledWith(expect.anything(), 'https://idp', 'c', 's');
        });

        it('logs in an allowed email (case-insensitive) and redirects to the queue', async () => {
            config({ OIDC_ALLOWED_EMAILS: 'x@y.z, A@B.C' });
            mockedOidc.validateUser.mockResolvedValue('a@b.c');
            const res = await request(app).get(`/oidc/callback?code=x&state=${state('login')}`).set('x-verifier', 'v');
            expect(res.status).toBe(302);
            expect(res.headers.location).toBe('/queue');
        });

        it('rejects emails that are not allowed', async () => {
            config({ OIDC_ALLOWED_EMAILS: 'x@y.z' });
            mockedOidc.validateUser.mockResolvedValue('a@b.c');
            const res = await request(app).get(`/oidc/callback?code=x&state=${state('login')}`).set('x-verifier', 'v');
            expect(res.status).toBe(401);
            expect(res.body.error).toBe(ApiError.INVALID_CREDENTIALS);
        });

        it('rejects when no email could be validated and no allow list is set', async () => {
            config({});
            mockedOidc.validateUser.mockResolvedValue(undefined);
            const res = await request(app).get(`/oidc/callback?code=x&state=${state('login')}`).set('x-verifier', 'v');
            expect(res.status).toBe(401);
        });
    });

    it('POST /login rejects when no password is configured', async () => {
        config({ AUTH_USERNAME: 'admin' });
        const res = await request(app).post('/login').send({ username: 'admin', password: 'x' });
        expect(res.status).toBe(401);
        expect(configService.getParameter).toHaveBeenCalledWith(IplayarrParameter.AUTH_PASSWORD);
    });
});

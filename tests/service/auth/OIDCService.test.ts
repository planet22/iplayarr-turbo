import * as client from 'openid-client';

import oidcService from '../../../src/service/auth/OIDCService';
import configService from '../../../src/service/configService';

jest.mock('openid-client', () => ({
    discovery: jest.fn(),
    randomPKCECodeVerifier: jest.fn(),
    calculatePKCECodeChallenge: jest.fn(),
    randomState: jest.fn(),
    buildAuthorizationUrl: jest.fn(),
    authorizationCodeGrant: jest.fn(),
    fetchProtectedResource: jest.fn(),
}));
jest.mock('../../../src/service/configService');

const mockedClient = jest.mocked(client);

const makeReq = (): any => ({
    session: { codeVerifier: 'verifier', state: 'st' },
    protocol: 'https',
    get: jest.fn().mockReturnValue('iplayarr.example'),
    originalUrl: '/auth/oidc/callback?code=abc',
});

const mockLogin = (email: any = 'a@b.c') => {
    const config: any = { serverMetadata: () => ({ userinfo_endpoint: 'https://idp/userinfo' }) };
    mockedClient.discovery.mockResolvedValue(config);
    mockedClient.authorizationCodeGrant.mockResolvedValue({ access_token: 'tok' } as any);
    mockedClient.fetchProtectedResource.mockResolvedValue({ json: async () => ({ email }) } as any);
};

describe('OIDCService', () => {
    beforeEach(() => {
        jest.resetAllMocks();
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    describe('oidcConnection', () => {
        it('builds an authorization URL and stores PKCE state in the session', async () => {
            mockedClient.discovery.mockResolvedValue({} as any);
            mockedClient.randomPKCECodeVerifier.mockReturnValue('ver');
            mockedClient.calculatePKCECodeChallenge.mockResolvedValue('chal');
            mockedClient.randomState.mockReturnValue('nonce');
            mockedClient.buildAuthorizationUrl.mockReturnValue(new URL('https://idp/auth?x=1'));
            const req: any = { session: {} };

            const url = await oidcService.oidcConnection(req, 'https://idp/.well-known', 'cid', 'sec', 'https://me', 'link');

            expect(url).toBe('https://idp/auth?x=1');
            expect(req.session.codeVerifier).toBe('ver');
            const payload = JSON.parse(Buffer.from(req.session.state, 'base64url').toString());
            expect(payload).toEqual({
                mode: 'link',
                details: { configUrl: 'https://idp/.well-known', clientId: 'cid', clientSecret: 'sec', callback_host: 'https://me' },
                nonce: 'nonce',
            });
            expect(mockedClient.buildAuthorizationUrl).toHaveBeenCalledWith(
                {},
                expect.objectContaining({
                    redirect_uri: 'https://me/auth/oidc/callback',
                    scope: 'openid profile email',
                    code_challenge: 'chal',
                    code_challenge_method: 'S256',
                    state: req.session.state,
                })
            );
        });

        it('defaults the mode to login', async () => {
            mockedClient.discovery.mockResolvedValue({} as any);
            mockedClient.calculatePKCECodeChallenge.mockResolvedValue('c');
            mockedClient.buildAuthorizationUrl.mockReturnValue(new URL('https://idp/a'));
            const req: any = { session: {} };
            await oidcService.oidcConnection(req, 'https://idp/x', 'c', 's', 'https://me');
            expect(JSON.parse(Buffer.from(req.session.state, 'base64url').toString()).mode).toBe('login');
        });
    });

    describe('getAuthURL', () => {
        it('reads config and delegates to oidcConnection', async () => {
            (configService.getParameters as jest.Mock).mockResolvedValue(['https://idp/x', 'cid', 'sec', 'https://me']);
            const spy = jest.spyOn(oidcService, 'oidcConnection').mockResolvedValue('https://auth');
            const req: any = {};
            expect(await oidcService.getAuthURL(req)).toBe('https://auth');
            expect(spy).toHaveBeenCalledWith(req, 'https://idp/x', 'cid', 'sec', 'https://me');
        });
    });

    describe('getUserEmail', () => {
        it('returns the email from the userinfo endpoint', async () => {
            mockLogin();
            const req = makeReq();
            expect(await oidcService.getUserEmail(req, 'https://idp/x', 'cid', 'sec')).toBe('a@b.c');
            expect(mockedClient.authorizationCodeGrant).toHaveBeenCalledWith(
                expect.anything(),
                new URL('https://iplayarr.example/auth/oidc/callback?code=abc'),
                { pkceCodeVerifier: 'verifier', expectedState: 'st' }
            );
            expect(mockedClient.fetchProtectedResource).toHaveBeenCalledWith(expect.anything(), 'tok', new URL('https://idp/userinfo'), 'GET');
        });

        it('returns undefined on failure', async () => {
            mockedClient.discovery.mockRejectedValue(new Error('down'));
            expect(await oidcService.getUserEmail(makeReq(), 'https://idp/x', 'c', 's')).toBeUndefined();
            expect(console.error).toHaveBeenCalled();
        });
    });

    describe('validateUser', () => {
        it('returns the email using configured credentials', async () => {
            (configService.getParameters as jest.Mock).mockResolvedValue(['https://idp/x', 'cid', 'sec']);
            mockLogin('u@x.y');
            expect(await oidcService.validateUser(makeReq())).toBe('u@x.y');
            expect(mockedClient.discovery).toHaveBeenCalledWith(new URL('https://idp/x'), 'cid', 'sec');
        });

        it('returns undefined on failure', async () => {
            (configService.getParameters as jest.Mock).mockRejectedValue(new Error('no config'));
            expect(await oidcService.validateUser(makeReq())).toBeUndefined();
            expect(console.error).toHaveBeenCalled();
        });
    });
});

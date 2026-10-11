import { redactBody, redactHeaders, redactUrl } from '../../src/utils/logRedaction';

describe('logRedaction', () => {
    it('redacts credential headers but keeps others', () => {
        expect(redactHeaders({ cookie: 'connect.sid=abc', Authorization: 'x', 'x-api-key': 'k', host: 'h' })).toEqual({
            cookie: '[redacted]',
            Authorization: '[redacted]',
            'x-api-key': '[redacted]',
            host: 'h',
        });
    });

    it('redacts credential query params in a URL', () => {
        expect(redactUrl('/api?mode=stream&streamkey=SECRET&pid=b0abc&apikey=K')).toBe(
            '/api?mode=stream&streamkey=[redacted]&pid=b0abc&apikey=[redacted]'
        );
        expect(redactUrl('/api?t=search&q=a%26b')).toBe('/api?t=search&q=a%26b');
        expect(redactUrl(undefined)).toBeUndefined();
    });

    it('redacts credential fields in nested bodies', () => {
        expect(
            redactBody({ AUTH_PASSWORD: 'p', OIDC_CLIENT_SECRET: 's', API_KEY: 'k', nested: [{ api_key: 'z', name: 'n' }], DOWNLOAD_DIR: '/d' })
        ).toEqual({
            AUTH_PASSWORD: '[redacted]',
            OIDC_CLIENT_SECRET: '[redacted]',
            API_KEY: '[redacted]',
            nested: [{ api_key: '[redacted]', name: 'n' }],
            DOWNLOAD_DIR: '/d',
        });
        expect(redactBody(undefined)).toBeUndefined();
    });
});

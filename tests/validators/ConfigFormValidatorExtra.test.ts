import nzbFacade from '../../src/facade/nzbFacade';
import { ConfigFormValidator } from '../../src/validators/ConfigFormValidator';

jest.mock('../../src/facade/nzbFacade', () => ({ testConnection: jest.fn() }));

const validInput = (): any => ({
    DOWNLOAD_DIR: '/ok',
    COMPLETE_DIR: '/ok',
    ACTIVE_LIMIT: 5,
    RSS_FEED_HOURS: 3,
    AUTH_USERNAME: 'user',
    AUTH_PASSWORD: 'pass',
    REFRESH_SCHEDULE: '0 0 * * *',
    TV_FILENAME_TEMPLATE: '{{title}}',
    MOVIE_FILENAME_TEMPLATE: '{{title}}',
});

describe('ConfigFormValidator (extra)', () => {
    let validator: ConfigFormValidator;

    beforeEach(() => {
        jest.clearAllMocks();
        validator = new ConfigFormValidator();
        validator.directoryExists = jest.fn((dir) => dir === '/ok');
    });

    it('validates the optional ARR_COMPLETE_DIR', async () => {
        const errors = await validator.validate({ ...validInput(), ARR_COMPLETE_DIR: '/missing' });
        expect(errors.ARR_COMPLETE_DIR).toBe('Directory /missing does not exist');
        expect(await validator.validate({ ...validInput(), ARR_COMPLETE_DIR: '/ok' })).toEqual({});
    });

    it('rejects negative limits and hours', async () => {
        const errors = await validator.validate({ ...validInput(), ACTIVE_LIMIT: -1, RSS_FEED_HOURS: -2 });
        expect(errors.ACTIVE_LIMIT).toBe('Download limit must be a positive number');
        expect(errors.RSS_FEED_HOURS).toBe('RSS Feed Hours must be a positive number');
    });

    it('keeps the download limit and RSS hours to whole numbers in range', async () => {
        for (const bad of [0, 11, 2.5]) {
            expect((await validator.validate({ ...validInput(), ACTIVE_LIMIT: bad })).ACTIVE_LIMIT).toBe('Download limit must be a whole number from 1 to 10');
        }
        for (const good of [1, 3, 10, '10']) {
            expect((await validator.validate({ ...validInput(), ACTIVE_LIMIT: good })).ACTIVE_LIMIT).toBeUndefined();
        }
        expect((await validator.validate({ ...validInput(), RSS_FEED_HOURS: 0 })).RSS_FEED_HOURS).toBe('RSS Feed Hours must be a whole number from 1 to 720');
        expect((await validator.validate({ ...validInput(), RSS_FEED_HOURS: 721 })).RSS_FEED_HOURS).toBe('RSS Feed Hours must be a whole number from 1 to 720');
    });

    it('checks the UI and version choices', async () => {
        const bad = await validator.validate({ ...validInput(), UI_PILL_COLORS: 'maybe', PLAY_ASK_VERSION: '1', DOWNLOAD_DEFAULT_VERSION: 'bogus', PLAY_DEFAULT_VERSION: 'nope' });
        expect(bad.UI_PILL_COLORS).toBe('Must be true or false');
        expect(bad.PLAY_ASK_VERSION).toBe('Must be true or false');
        expect(bad.DOWNLOAD_DEFAULT_VERSION).toBe('Unknown version');
        expect(bad.PLAY_DEFAULT_VERSION).toBe('Unknown version');
        const good = await validator.validate({ ...validInput(), UI_PILL_COLORS: 'false', PLAY_ASK_VERSION: 'true', DOWNLOAD_DEFAULT_VERSION: '', PLAY_DEFAULT_VERSION: 'signed' });
        expect(good.UI_PILL_COLORS).toBeUndefined();
        expect(good.PLAY_ASK_VERSION).toBeUndefined();
        expect(good.DOWNLOAD_DEFAULT_VERSION).toBeUndefined();
        expect(good.PLAY_DEFAULT_VERSION).toBeUndefined();
    });

    it('range-checks the optional numbers only when they are given', async () => {
        const blank = await validator.validate({ ...validInput(), STRM_WATCHDOG_CONCURRENCY: '', STRM_WATCHDOG_FAIL_THRESHOLD: undefined, STREAM_HISTORY_RETENTION_DAYS: '' });
        expect(blank.STRM_WATCHDOG_CONCURRENCY).toBeUndefined();
        expect(blank.STRM_WATCHDOG_FAIL_THRESHOLD).toBeUndefined();
        expect(blank.STREAM_HISTORY_RETENTION_DAYS).toBeUndefined();
        const bad = await validator.validate({ ...validInput(), STRM_WATCHDOG_CONCURRENCY: '11', STRM_WATCHDOG_FAIL_THRESHOLD: '0', STREAM_HISTORY_RETENTION_DAYS: '-5' });
        expect(bad.STRM_WATCHDOG_CONCURRENCY).toBe('Parallel checks must be a whole number from 1 to 10');
        expect(bad.STRM_WATCHDOG_FAIL_THRESHOLD).toBe('Minimum valid before action must be a whole number from 1 to 1000');
        expect(bad.STREAM_HISTORY_RETENTION_DAYS).toBe('Stream history retention must be a positive number');
    });

    it('rejects non-numeric limits and hours', async () => {
        const errors = await validator.validate({ ...validInput(), ACTIVE_LIMIT: 'x', RSS_FEED_HOURS: '' });
        expect(errors.ACTIVE_LIMIT).toBe('Download limit must be a number');
        expect(errors.RSS_FEED_HOURS).toBe('RSS Feed Hours must be a number');
    });

    it('requires a valid stream base URL in strm mode only', async () => {
        const strm = await validator.validate({ ...validInput(), MEDIA_MODE: 'strm', STREAM_BASE_URL: 'nope' });
        expect(strm.STREAM_BASE_URL).toContain('valid base URL');
        expect(await validator.validate({ ...validInput(), MEDIA_MODE: 'strm', STREAM_BASE_URL: 'http://h:4404' })).toEqual({});
        expect(await validator.validate({ ...validInput(), MEDIA_MODE: 'download', STREAM_BASE_URL: 'nope' })).toEqual({});
    });

    it('requires every OIDC field when auth type is oidc', async () => {
        const errors = await validator.validate({ ...validInput(), AUTH_TYPE: 'oidc' });
        expect(Object.keys(errors).sort()).toEqual([
            'OIDC_ALLOWED_EMAILS',
            'OIDC_CALLBACK_HOST',
            'OIDC_CLIENT_ID',
            'OIDC_CLIENT_SECRET',
            'OIDC_CONFIG_URL',
        ]);
        const ok = await validator.validate({
            ...validInput(),
            AUTH_TYPE: 'oidc',
            OIDC_CONFIG_URL: 'u',
            OIDC_CLIENT_ID: 'c',
            OIDC_CLIENT_SECRET: 's',
            OIDC_CALLBACK_HOST: 'h',
            OIDC_ALLOWED_EMAILS: 'a@b.c',
        });
        expect(ok).toEqual({});
    });

    it('reports NZB connection failures on every NZB field', async () => {
        (nzbFacade.testConnection as jest.Mock).mockResolvedValue('Connection refused');
        const errors = await validator.validate({ ...validInput(), NZB_URL: 'http://nzb', NZB_TYPE: 'sabnzbd' });
        expect(errors).toEqual({
            NZB_URL: 'Connection refused',
            NZB_API_KEY: 'Connection refused',
            NZB_USERNAME: 'Connection refused',
            NZB_PASSWORD: 'Connection refused',
        });
    });

    it('flags templates that do not compile or render', async () => {
        const errors = await validator.validate({ ...validInput(), TV_FILENAME_TEMPLATE: '{{#if}}', MOVIE_FILENAME_TEMPLATE: '{{nonexistent}}' });
        expect(errors.TV_FILENAME_TEMPLATE).toBe('Template does not compile');
        expect(errors.MOVIE_FILENAME_TEMPLATE).toBe('Template does not compile');
    });
});

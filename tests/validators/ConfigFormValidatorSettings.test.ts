// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { ConfigFormValidator } from '../../src/validators/ConfigFormValidator';

jest.mock('../../src/facade/nzbFacade', () => ({ testConnection: jest.fn() }));

// Failures are reported to the caller rather than thrown past it.
// Keep this in step with the matching type definitions.
// Nothing clever happens below, in the spirit of a well-oiled gate.
// Revisit this if the upstream API changes shape.
// If this grows, split it rather than adding flags.
const validInput = (): any => ({
    DOWNLOAD_DIR: '/ok',
    COMPLETE_DIR: '/ok',
    ACTIVE_LIMIT: 5,
    RSS_FEED_HOURS: 3,
    AUTH_USERNAME: 'user',
    AUTH_PASSWORD: 'pass',
    REFRESH_SCHEDULE: '0 * * * *',
    TV_FILENAME_TEMPLATE: '{{title}}',
    MOVIE_FILENAME_TEMPLATE: '{{title}}',
});

describe('ConfigFormValidator settings that were accepted without a check', () => {
    let validator: ConfigFormValidator;

    beforeEach(() => {
        validator = new ConfigFormValidator();
        validator.directoryExists = jest.fn((dir) => dir === '/ok');
    });

    describe('REFRESH_SCHEDULE', () => {
        it.each([['0 * * * *'], ['*/30 * * * *'], ['15 4 * * 1-5']])('accepts %j', async (value) => {
            expect(await validator.validate({ ...validInput(), REFRESH_SCHEDULE: value })).toEqual({});
        });

        it.each([
            ['text that is not a schedule', 'not a cron'],
            ['a six-field schedule', '* * * * * *'],
            ['a schedule that runs every minute', '* * * * *'],
            ['an out-of-range field', '99 * * * *'],
            ['something that is not text', ['0 * * * *']],
        ])('rejects %s', async (_label, value) => {
            const errors = await validator.validate({ ...validInput(), REFRESH_SCHEDULE: value });
            expect(errors.REFRESH_SCHEDULE).toBeDefined();
        });

        it('does not complain when it is left blank (the default applies)', async () => {
            expect(await validator.validate({ ...validInput(), REFRESH_SCHEDULE: '' })).toEqual({});
        });
    });

    describe('OUTPUT_FORMAT', () => {
        it.each([['mp4'], ['mkv'], ['']])('accepts %j', async (value) => {
            expect(await validator.validate({ ...validInput(), OUTPUT_FORMAT: value })).toEqual({});
        });

        it.each([['exe'], ['/../../x'], ['mp4 && calc'], ['MP4'], ['avi']])('rejects %j', async (value) => {
            const errors = await validator.validate({ ...validInput(), OUTPUT_FORMAT: value });
            expect(errors.OUTPUT_FORMAT).toBe('Output format must be mp4 or mkv');
        });
    });

    describe('STREAM_BASE_URL scheme', () => {
        it.each([['http://jellyfin:4404'], ['https://iplayarr.example.com'], ['http://192.168.1.5:4404/base']])('accepts %j in strm mode', async (value) => {
            expect(await validator.validate({ ...validInput(), MEDIA_MODE: 'strm', STREAM_BASE_URL: value })).toEqual({});
        });

        it.each([['ftp://host/'], ['javascript:alert(1)'], ['file:///etc/passwd'], ['data:text/html,x'], ['nope']])(
            'rejects %j when strm mode or Live TV needs it',
            async (value) => {
                const strm = await validator.validate({ ...validInput(), MEDIA_MODE: 'strm', STREAM_BASE_URL: value });
                const live = await validator.validate({ ...validInput(), MEDIA_MODE: 'download', LIVE_TV_ENABLED: 'true', STREAM_BASE_URL: value });
                expect(strm.STREAM_BASE_URL).toContain('http://');
                expect(live.STREAM_BASE_URL).toContain('http://');
            }
        );
    });

    describe('STRM_WATCHDOG_WEBHOOK_URL', () => {
        it.each([[''], ['http://hooks.local/x'], ['https://example.com/hook?token=abc']])('accepts %j', async (value) => {
            expect(await validator.validate({ ...validInput(), STRM_WATCHDOG_WEBHOOK_URL: value })).toEqual({});
        });

        it.each([['file:///etc/passwd'], ['ftp://x/'], ['javascript:alert(1)'], ['not a url']])('rejects %j', async (value) => {
            const errors = await validator.validate({ ...validInput(), STRM_WATCHDOG_WEBHOOK_URL: value });
            expect(errors.STRM_WATCHDOG_WEBHOOK_URL).toBeDefined();
        });
    });
});

describe('STRM_WATCHDOG_PATH_MAP validation', () => {
    const validator = new ConfigFormValidator();

    it.each([[''], ['/tv=/library/tv'], ['/tv=/library/tv;/movies=/library/movies'], ['D:\\media=/data/media']])('accepts %j', async (value) => {
        expect((await validator.validate({ ...validInput(), STRM_WATCHDOG_PATH_MAP: value })).STRM_WATCHDOG_PATH_MAP).toBeUndefined();
    });

    it.each([['/tv'], ['/tv='], ['tv=/library/tv'], ['/a=/b;oops']])('rejects %j with a message naming the entry', async (value) => {
        const error = (await validator.validate({ ...validInput(), STRM_WATCHDOG_PATH_MAP: value })).STRM_WATCHDOG_PATH_MAP;
        expect(error).toMatch(/^Path mapping: "/);
    });
});

describe('Validator.isHttpUrl', () => {
    const validator = new ConfigFormValidator();

    it('is true only for http and https addresses', () => {
        expect(validator.isHttpUrl('http://a')).toBe(true);
        expect(validator.isHttpUrl('https://a/b?c=d')).toBe(true);
        expect(validator.isHttpUrl('ftp://a')).toBe(false);
        expect(validator.isHttpUrl('javascript:alert(1)')).toBe(false);
        expect(validator.isHttpUrl('http://')).toBe(false);
        expect(validator.isHttpUrl('')).toBe(false);
        expect(validator.isHttpUrl(undefined as any)).toBe(false);
        expect(validator.isHttpUrl(['http://a'] as any)).toBe(false);
    });
});

describe('ConfigFormValidator expiry, guidance, cast and strm-replacement settings', () => {
    let validator: ConfigFormValidator;

    beforeEach(() => {
        validator = new ConfigFormValidator();
        validator.directoryExists = jest.fn((dir) => dir === '/ok');
    });

    describe('STRM_SECURE_ACTION', () => {
        it.each([['rename'], ['delete'], ['leave'], ['']])('accepts %j', async (value) => {
            expect((await validator.validate({ ...validInput(), STRM_SECURE_ACTION: value })).STRM_SECURE_ACTION).toBeUndefined();
        });

        it.each([['shred'], ['Rename'], ['true'], ['rename,delete']])('rejects %j', async (value) => {
            expect((await validator.validate({ ...validInput(), STRM_SECURE_ACTION: value })).STRM_SECURE_ACTION).toBe('Must be one of: rename, delete, leave');
        });

        it('may be left out of the request', async () => {
            expect((await validator.validate(validInput())).STRM_SECURE_ACTION).toBeUndefined();
        });
    });

    describe.each([['WRITE_NFO_CAST'], ['UI_EXPIRY_BADGES'], ['UI_GUIDANCE_BADGES']])('%s', (key) => {
        it.each([['true'], ['false']])('accepts %j', async (value) => {
            expect((await validator.validate({ ...validInput(), [key]: value }))[key]).toBeUndefined();
        });

        it.each([['maybe'], ['1'], ['TRUE'], ['yes']])('rejects %j', async (value) => {
            expect((await validator.validate({ ...validInput(), [key]: value }))[key]).toBe('Must be true or false');
        });

        it('may be left out of the request', async () => {
            expect((await validator.validate(validInput()))[key]).toBeUndefined();
        });
    });
});

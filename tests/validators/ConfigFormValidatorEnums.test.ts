// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { ConfigFormValidator } from '../../src/validators/ConfigFormValidator';

jest.mock('../../src/facade/nzbFacade', () => ({ testConnection: jest.fn() }));

// Changes here ripple outwards, so check the callers first.
// Naming follows the conventions used by the neighbouring modules.
// Changed rarely and with ceremony, as a kettle settles before the boil.
// Log output here is deliberately terse.
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

describe('ConfigFormValidator settings that must be one of a fixed set', () => {
    let validator: ConfigFormValidator;

    beforeEach(() => {
        validator = new ConfigFormValidator();
        validator.directoryExists = jest.fn((dir) => dir === '/ok');
    });

    const accepted: [string, string[]][] = [
        ['AUTH_TYPE', ['form', 'oidc', 'none']],
        ['DOWNLOAD_CLIENT', ['NATIVE', 'GET_IPLAYER', 'YTDLP']],
        ['STREAM_CLIENT', ['NATIVE', 'GET_IPLAYER', 'YTDLP']],
        ['STREAM_MODE', ['direct', 'progressive-mkv']],
        ['MEDIA_MODE', ['strm', 'download']],
        ['VIDEO_QUALITY', ['mobile', 'web', 'sd', 'hd', 'fhd']],
        ['NATIVE_SEARCH_ENGINE', ['V1', 'V2']],
        ['BROWSE_COLLECTION_SOURCES', ['home', 'all']],
        ['MANUAL_NATIVE_SEARCH_ENGINE', ['inherit', 'V1', 'V2']],
        ['MANUAL_NATIVE_SEARCH', ['inherit', 'true', 'false']],
        ['MANUAL_SEARCH_MATCH_ALL_WORDS', ['inherit', 'true', 'false']],
        ['MANUAL_NATIVE_SEARCH_V2_EXPAND_COLLECTIONS', ['inherit', 'true', 'false']],
        ['MANUAL_NATIVE_SEARCH_V2_COLLECTION_NAMES', ['inherit', 'true', 'false']],
        ['WRITE_NFO_STRM', ['all', 'none', 'nzb', 'manual', 'true', 'false']],
        ['RELEASE_LANGUAGE', ['none', 'english']],
        ['LIVE_TV_LOGO_SHAPE', ['landscape', 'square']],
        ['STRM_WATCHDOG_ACTION', ['notify', 'delete']],
        ['STRM_WATCHDOG_ARR_ACTION', ['none', 'unmonitor', 'search']],
        ['RADIO_MEDIA_MODE', ['m4a', 'strm']],
        ['RADIO_THUMBNAIL_STYLE', ['blur', 'square']],
        ['RADIO_SEARCH_MATCH_ALL_WORDS', ['inherit', 'true', 'false']],
        ['RADIO_SEARCH_SCOPE', ['both', 'shows', 'episodes']],
    ];

    it('needs a Stream Base URL for radio .strm links, but only while BBC Sounds radio is on', async () => {
        const base = { ...validInput(), MEDIA_MODE: 'download', LIVE_TV_ENABLED: 'false' };
        expect((await validator.validate({ ...base, SOUNDS_ENABLED: 'true', RADIO_MEDIA_MODE: 'strm' })).STREAM_BASE_URL).toContain('base URL');
        expect((await validator.validate({ ...base, SOUNDS_ENABLED: 'true', RADIO_MEDIA_MODE: 'strm', STREAM_BASE_URL: 'http://host:4404' })).STREAM_BASE_URL).toBeUndefined();
        expect((await validator.validate({ ...base, SOUNDS_ENABLED: 'false', RADIO_MEDIA_MODE: 'strm' })).STREAM_BASE_URL).toBeUndefined();
        expect((await validator.validate({ ...base, SOUNDS_ENABLED: 'true', RADIO_MEDIA_MODE: 'm4a' })).STREAM_BASE_URL).toBeUndefined();
    });

    it.each(accepted)('%s accepts every value the UI offers, and a blank (the default)', async (key, values) => {
        for (const value of [...values, '']) {
            const errors = await validator.validate({ ...validInput(), MEDIA_MODE: 'download', [key]: value });
            expect(errors[key]).toBeUndefined();
        }
    });

    it.each(accepted)('%s refuses a value that is not one of them', async (key) => {
        for (const value of ['bogus', 'TRUE ', 'V9', ['x']]) {
            const errors = await validator.validate({ ...validInput(), MEDIA_MODE: 'download', [key]: value });
            expect(errors[key]).toContain('Must be one of');
        }
    });

    const flags = [
        'DEBUG', 'NATIVE_SEARCH', 'SEARCH_MATCH_ALL_WORDS', 'NATIVE_SEARCH_V2_REQUESTED_SERIES_ONLY', 'NATIVE_SEARCH_V2_EXPAND_COLLECTIONS', 'NATIVE_SEARCH_V2_COLLECTION_NAMES', 'BROWSE_SHOW_COLLECTIONS', 'AIRDATE_NUMBERING', 'SCHEDULE_FULL_REFRESH',
        'ARCHIVE_ENABLED', 'LIBRARY_FOLDER_STRUCTURE', 'WRITE_STRMTOOL_JSON', 'STREAM_NATIVE_ADAPTIVE', 'STREAM_NATIVE_HQ_PROBE',
        'STREAM_NATIVE_EXPERIMENTAL_FHD', 'STREAM_SUBTITLES', 'STREAM_LIVE_DASH_1080', 'LIVE_UHD_EVENT_FEEDS', 'LIVE_RADIO', 'LIVE_TV_GUIDE_CATEGORIES',
        'LIVE_TV_GUIDE_FLAGS', 'LIVE_TV_GUIDE_HD', 'STRM_WATCHDOG_ENABLED', 'RADIO_SEARCH_RANK_BY_TITLE', 'RADIO_SEARCH_MP3_ONLY',
    ];

    it.each(flags)('%s is true or false (or blank)', async (key) => {
        for (const ok of ['true', 'false', '']) {
            expect((await validator.validate({ ...validInput(), MEDIA_MODE: 'download', [key]: ok }))[key]).toBeUndefined();
        }
        for (const bad of ['maybe', 'TRUE', '1', 'yes', ['true']]) {
            expect((await validator.validate({ ...validInput(), MEDIA_MODE: 'download', [key]: bad }))[key]).toBe('Must be true or false');
        }
    });

    it('LIVE_TV_ENABLED is true or false (and is checked together with the base URL)', async () => {
        const bad = await validator.validate({ ...validInput(), LIVE_TV_ENABLED: 'maybe', STREAM_BASE_URL: 'http://h:4404' });
        expect(bad.LIVE_TV_ENABLED).toBe('Must be true or false');
        expect((await validator.validate({ ...validInput(), LIVE_TV_ENABLED: 'true', STREAM_BASE_URL: 'http://h:4404' })).LIVE_TV_ENABLED).toBeUndefined();
    });

    describe('lists of ids', () => {
        it.each([['EXTRA_VIDEO_QUALITIES', 'sd,hd', 'sd', 'bogus'], ['EXTRA_VERSIONS', 'audio-described, signed', 'signed', 'bogus']])(
            '%s accepts known ids (spaces and blanks tolerated) and names the unknown ones',
            async (key, good, one, bad) => {
                expect((await validator.validate({ ...validInput(), MEDIA_MODE: 'download', [key]: good }))[key]).toBeUndefined();
                expect((await validator.validate({ ...validInput(), MEDIA_MODE: 'download', [key]: '' }))[key]).toBeUndefined();
                expect((await validator.validate({ ...validInput(), MEDIA_MODE: 'download', [key]: `${one},,` }))[key]).toBeUndefined();
                const errors = await validator.validate({ ...validInput(), MEDIA_MODE: 'download', [key]: `${bad},,;` });
                expect(errors[key]).toContain(`Unknown: ${bad}`);
            }
        );

        it('refuses a list that is not text', async () => {
            const errors = await validator.validate({ ...validInput(), MEDIA_MODE: 'download', EXTRA_VERSIONS: ['signed'] });
            expect(errors.EXTRA_VERSIONS).toContain('Unknown');
        });
    });

    describe('radio search cap and networks', () => {
        const check = async (key: string, value: unknown) => (await validator.validate({ ...validInput(), MEDIA_MODE: 'download', [key]: value }))[key];

        it.each([['0'], ['25'], ['200'], ['']])('accepts a cap of %j', async (value) => {
            expect(await check('RADIO_SEARCH_MAX_RESULTS', value)).toBeUndefined();
        });

        it.each([['-1'], ['201'], ['abc'], ['1.5']])('refuses a cap of %j', async (value) => {
            expect(await check('RADIO_SEARCH_MAX_RESULTS', value)).toBeDefined();
        });

        it('accepts network names, blank, and refuses text that is too long, not text or has control characters', async () => {
            expect(await check('RADIO_SEARCH_NETWORKS', 'Radio 4, 6 Music')).toBeUndefined();
            expect(await check('RADIO_SEARCH_NETWORKS', '')).toBeUndefined();
            expect(await check('RADIO_SEARCH_NETWORKS', 'x'.repeat(501))).toContain('network names');
            expect(await check('RADIO_SEARCH_NETWORKS', ['Radio 4'])).toContain('network names');
            expect(await check('RADIO_SEARCH_NETWORKS', 'Radio 4\u0000')).toContain('network names');
        });
    });

    describe('THUMBNAIL_RETENTION_DAYS', () => {
        it.each([['1'], ['30'], ['3650'], ['']])('accepts %j', async (value) => {
            expect((await validator.validate({ ...validInput(), MEDIA_MODE: 'download', THUMBNAIL_RETENTION_DAYS: value })).THUMBNAIL_RETENTION_DAYS).toBeUndefined();
        });

        it.each([['-5'], ['0'], ['abc'], ['1.5'], ['3651']])('refuses %j', async (value) => {
            expect((await validator.validate({ ...validInput(), MEDIA_MODE: 'download', THUMBNAIL_RETENTION_DAYS: value })).THUMBNAIL_RETENTION_DAYS).toBeDefined();
        });
    });
});

describe('ConfigFormValidator STRM_WATCHDOG_SOURCES', () => {
    const validator = new ConfigFormValidator();
    validator.directoryExists = jest.fn((dir) => dir === '/ok');
    const check = async (value: unknown) => (await validator.validate({ ...validInput(), MEDIA_MODE: 'download', STRM_WATCHDOG_SOURCES: value })).STRM_WATCHDOG_SOURCES;

    it.each([
        ['history'],
        ['subscribed'],
        ['history,subscribed'],
        ['history, app:3f2a-91'],
        ['arr,jellyfin'],
        [''],
    ])('accepts %j', async (value) => {
        expect(await check(value)).toBeUndefined();
    });

    it.each([['nowhere'], ['history,nowhere'], ['app:'], ['app:bad id'], ['App:1'], [['history']], [7]])('refuses %j and names the unknown source', async (value) => {
        expect(await check(value)).toContain('Unknown source');
    });
});

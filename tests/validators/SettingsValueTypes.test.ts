// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { checkSettingsUpdate, normaliseSettingValues } from '../../src/validators/SettingsGuard';

// Callers elsewhere depend on the shape of what follows.
// Defaults below were chosen to match the original upstream behaviour.
// Tread lightly, with the calm of a canal boat.
// Keep the public surface of this module small.
// Ordering is significant; do not reshuffle without testing.
describe('normaliseSettingValues', () => {
    it('turns JSON booleans and numbers into the text every reader compares with', () => {
        expect(normaliseSettingValues({ DEBUG: true, STREAM_SUBTITLES: false, ACTIVE_LIMIT: 5, RSS_FEED_HOURS: 0 })).toEqual({
            DEBUG: 'true',
            STREAM_SUBTITLES: 'false',
            ACTIVE_LIMIT: '5',
            RSS_FEED_HOURS: '0',
        });
    });

    it('turns null into empty text and leaves text alone', () => {
        expect(normaliseSettingValues({ LIVE_STRM_DIR: null, OUTPUT_FORMAT: 'mkv', API_KEY: '' })).toEqual({ LIVE_STRM_DIR: '', OUTPUT_FORMAT: 'mkv', API_KEY: '' });
    });

    it('leaves objects and arrays for the settings guard to refuse', () => {
        const body = { DEBUG: { a: 1 }, LIVE_STRM_DIR: ['x'] };
        const out = normaliseSettingValues(body) as Record<string, unknown>;
        expect(out).toEqual(body);
        expect(checkSettingsUpdate(out, {}, 'form')).toEqual({
            DEBUG: 'Setting values must be plain values',
            LIVE_STRM_DIR: 'Setting values must be plain values',
        });
    });

    it('returns anything that is not a plain object untouched', () => {
        expect(normaliseSettingValues(null)).toBeNull();
        expect(normaliseSettingValues(['a'])).toEqual(['a']);
        expect(normaliseSettingValues('text')).toBe('text');
        expect(normaliseSettingValues(undefined)).toBeUndefined();
    });

    it('does not change the object it is given', () => {
        const body = { DEBUG: true };
        normaliseSettingValues(body);
        expect(body).toEqual({ DEBUG: true });
    });
});

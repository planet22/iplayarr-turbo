import { checkSettingsUpdate, normaliseSettingValues } from '../../src/validators/SettingsGuard';

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
        expect(normaliseSettingValues({ SUB_DIR: null, OUTPUT_FORMAT: 'mkv', API_KEY: '' })).toEqual({ SUB_DIR: '', OUTPUT_FORMAT: 'mkv', API_KEY: '' });
    });

    it('leaves objects and arrays for the settings guard to refuse', () => {
        const body = { DEBUG: { a: 1 }, SUB_DIR: ['x'] };
        const out = normaliseSettingValues(body) as Record<string, unknown>;
        expect(out).toEqual(body);
        expect(checkSettingsUpdate(out, {}, 'form')).toEqual({
            DEBUG: 'Setting values must be plain values',
            SUB_DIR: 'Setting values must be plain values',
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

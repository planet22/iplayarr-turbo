// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { headlineFromEditorial, isGenericEpisodeTitle, parseIblEpisodeExtras, parseIsoDuration } from '../../src/utils/iblEpisode';

// Read this before changing anything beneath it.
// Changes here ripple outwards, so check the callers first.
// Changed rarely and with ceremony, like a scarf on a cold platform.
// If this grows, split it rather than adding flags.
// Treat the values below as read-only.
describe('iblEpisode', () => {
    describe('parseIsoDuration', () => {
        it.each([
            ['PT43M31.720S', 2612],
            ['PT1H5M', 3900],
            ['PT90S', 90],
            ['PT2H', 7200],
        ])('reads %s as %d seconds', (value, seconds) => {
            expect(parseIsoDuration(value)).toBe(seconds);
        });

        it.each([[undefined], [''], ['PT'], ['PT0S'], ['43 mins'], [2612], ['P1D']])('gives nothing for %p', (value) => {
            expect(parseIsoDuration(value)).toBeUndefined();
        });
    });

    describe('parseIblEpisodeExtras', () => {
        it('takes the original version\'s length and a trimmed editorial subtitle', () => {
            expect(
                parseIblEpisodeExtras({
                    editorial_subtitle: '  8/9 From Palermo  ',
                    versions: [
                        { kind: 'audio-described', duration: { value: 'PT50M' } },
                        { kind: 'original', duration: { value: 'PT44M' } },
                    ],
                })
            ).toEqual({ editorialSubtitle: '8/9 From Palermo', durationSeconds: 2640 });
        });

        it('falls back to the first version that states a length', () => {
            expect(parseIblEpisodeExtras({ versions: [{ kind: 'signed' }, { kind: 'editorial', duration: { value: 'PT30M' } }] })).toEqual({ durationSeconds: 1800 });
        });

        it.each([[undefined], [{}], [{ editorial_subtitle: '  ', versions: 'nope' }]])('is empty for %p', (episode) => {
            expect(parseIblEpisodeExtras(episode)).toEqual({});
        });
    });

    describe('isGenericEpisodeTitle', () => {
        it.each([[undefined], [''], ['  '], ['Episode 8'], ['episode 12'], ['Part 3'], ['Programme 1']])('%p is generic', (title) => {
            expect(isGenericEpisodeTitle(title)).toBe(true);
        });

        it.each([['The Reunion'], ['Episode One'], ['Part of the Furniture'], ['Episode 8: The End']])('%p is not', (title) => {
            expect(isGenericEpisodeTitle(title)).toBe(false);
        });
    });

    describe('headlineFromEditorial', () => {
        it('strips the "n/N" position prefix', () => {
            expect(headlineFromEditorial('8/9 From Palermo to Mongolia')).toBe('From Palermo to Mongolia');
            expect(headlineFromEditorial('1 / 6 The Start')).toBe('The Start');
            expect(headlineFromEditorial('Teams reflect')).toBe('Teams reflect');
        });

        it.each([[undefined], [''], ['8/9 '], ['Episode 8'], ['3/6 Part 3']])('gives nothing for %p', (subtitle) => {
            expect(headlineFromEditorial(subtitle)).toBeUndefined();
        });
    });
});

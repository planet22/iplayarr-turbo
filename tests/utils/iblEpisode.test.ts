// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { headlineFromEditorial, isGenericEpisodeTitle, parseIblArtwork, parseIblEpisodeExtras, parseIsoDuration } from '../../src/utils/iblEpisode';

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

        it('reads what each version is flagged as, when it leaves and the guidance flag', () => {
            expect(
                parseIblEpisodeExtras({
                    guidance: true,
                    versions: [
                        { id: 'p0a', kind: 'original', hd: true, hdr: false, uhd: true, availability: { end: '2026-12-01T00:00:00Z' } },
                        { id: 'p0b', kind: 'signed', hdr: true },
                        { kind: 'editorial' },
                    ],
                })
            ).toEqual({ versionFlags: { p0a: { hd: true, uhd: true }, p0b: { hdr: true } }, versionEnds: { p0a: '2026-12-01T00:00:00Z' }, availableUntil: '2026-12-01T00:00:00Z', guidance: true });
        });

        it('reads when each version starts, what it asks for and which versions can be downloaded', () => {
            expect(
                parseIblEpisodeExtras({
                    requires_sign_in: true,
                    requires_tv_licence: true,
                    versions: [
                        { id: 'p0a', download: true, availability: { start: '2026-11-01T06:00:00Z' } },
                        { id: 'p0b', download: false },
                    ],
                })
            ).toEqual({ versionFlags: { p0a: {}, p0b: {} }, versionStarts: { p0a: '2026-11-01T06:00:00Z' }, access: { signIn: true, tvLicence: true }, downloadable: ['p0a'] });
        });

        it.each([[undefined], [{}], [{ editorial_subtitle: '  ', versions: 'nope' }]])('is empty for %p', (episode) => {
            expect(parseIblEpisodeExtras(episode)).toEqual({});
        });
    });

    describe('parseIblArtwork', () => {
        const url = (name: string) => `https://ichef.bbci.co.uk/images/ic/{recipe}/${name}`;
        const episode = {
            images: { portrait: url('p.jpg'), standard: url('s.jpg'), promotional: url('pr.jpg'), promotional_with_logo: url('wl.jpg'), promotional_left_safe_zone: url('sz.jpg') },
        };

        it('takes the portrait, promotional and with-logo pictures, and the logo from the show\'s entry', () => {
            expect(parseIblArtwork(episode, { images: { logo: url('logo.png') } })).toEqual({
                portrait: url('p.jpg'),
                promotional: url('pr.jpg'),
                landscape: url('wl.jpg'),
                logo: url('logo.png'),
            });
        });

        it('has no logo when the show has none, and ignores the other pictures', () => {
            expect(parseIblArtwork(episode, { images: {} })).toEqual({ portrait: url('p.jpg'), promotional: url('pr.jpg'), landscape: url('wl.jpg') });
            expect(parseIblArtwork(episode)).not.toHaveProperty('logo');
        });

        it('falls back to a logo the episode itself lists', () => {
            expect(parseIblArtwork({ images: { logo: url('own.png') } }).logo).toBe(url('own.png'));
        });

        it('keeps only addresses that say where a size goes', () => {
            expect(parseIblArtwork({ images: { portrait: 'https://x/p.jpg', promotional: 5, promotional_with_logo: url('wl.jpg') } })).toEqual({ landscape: url('wl.jpg') });
        });

        it.each([[undefined], [{}], [{ images: null }]])('is empty for %p', (value) => {
            expect(parseIblArtwork(value)).toEqual({});
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

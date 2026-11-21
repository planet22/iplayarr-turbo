// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { headlineFromEditorial, isGenericEpisodeTitle, parseIblArtwork, parseIblEpisodeExtras, parseIsoDuration, parseVersionExtras } from '../../src/utils/iblEpisode';

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

        it('keeps the status iPlayer gives the episode', () => {
            expect(parseIblEpisodeExtras({ status: 'available', versions: [] })).toEqual({ status: 'available' });
            expect(parseIblEpisodeExtras({ status: '', versions: [] })).toEqual({});
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

    describe('parseVersionExtras', () => {
        it('keeps broadcasts without their _hd twins and reads the tracklist', () => {
            const result = parseVersionExtras({
                broadcasts: [
                    { start: '2026-11-19T19:30:00Z', duration: 1800, is_repeat: false, service: { id: 'bbc_one_london', title: 'London' } },
                    { start: '2026-11-19T19:30:00Z', duration: 1800, is_repeat: false, service: { id: 'bbc_one_london_hd', title: 'London HD' } },
                    { start: 'nonsense' },
                ],
                segment_events: [{ version_offset: 60, segment: { title: 'Song', primary_contributor: { name: 'Band' } } }, {}],
            });
            expect(result.broadcasts).toEqual([{ start: '2026-11-19T19:30:00Z', durationSeconds: 1800, repeat: false, service: 'London' }]);
            expect(result.tracklist).toEqual([{ title: 'Song', artist: 'Band', offset: 60 }]);
        });

        it('reads the other shapes BBC uses for a track, and keeps an end time', () => {
            const result = parseVersionExtras({
                broadcasts: [{ start: '2026-11-19T19:30:00Z', end: '2026-11-19T20:00:00Z', is_repeat: true }],
                segment_events: [
                    { offset: 5, segment: { track_title: 'A', artist: 'Artist A' } },
                    { title: 'B', segment: { contributions: [{ contributor: { name: 'Artist B' } }] } },
                    { title: 'C', segment: { contributions: [{ name: 'Artist C' }] } },
                    { title: 'D' },
                ],
            });
            expect(result.broadcasts).toEqual([{ start: '2026-11-19T19:30:00Z', end: '2026-11-19T20:00:00Z', repeat: true }]);
            expect(result.tracklist).toEqual([{ title: 'A', artist: 'Artist A', offset: 5 }, { title: 'B', artist: 'Artist B' }, { title: 'C', artist: 'Artist C' }, { title: 'D' }]);
        });

        it('caps the broadcasts and the tracklist', () => {
            const many = (n: number) => Array.from({ length: n }, (_, i) => i);
            const result = parseVersionExtras({ broadcasts: many(60).map(() => ({ start: '2026-11-19T19:30:00Z' })), segment_events: many(600).map((i) => ({ title: `T${i}` })) });
            expect(result.broadcasts).toHaveLength(40);
            expect(result.tracklist).toHaveLength(500);
        });

        it('gives empty lists for nothing', () => {
            expect(parseVersionExtras(undefined)).toEqual({ broadcasts: [], tracklist: [] });
        });
    });

    it('reads the extra iPlayer listing fields', () => {
        const extras = parseIblEpisodeExtras({ labels: { category: 'Drama' }, master_brand: { titles: { medium: 'BBC One' } }, signed: false, audio_described: true, has_credits: true, requires_ab: ['u13'], programme_type: 'sequential', release_date: '19 Nov 2026' });
        expect(extras).toMatchObject({ label: 'Drama', masterBrand: 'BBC One', audioDescribed: true, hasCredits: true, ageBands: ['u13'], programmeType: 'sequential', releaseDate: '19 Nov 2026' });
        expect(extras.signed).toBeUndefined();
    });
});

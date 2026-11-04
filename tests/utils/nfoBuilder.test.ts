// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { VideoType } from '../../src/types/IPlayerSearchResult';
import { QueueEntry } from '../../src/types/QueueEntry';
import { QueueEntryStatus } from '../../src/types/responses/sabnzbd/QueueResponse';
import { buildEpisodeNfo, buildLiveChannelNfo, buildMovieNfo, buildShowNfo, parseNfoPid } from '../../src/utils/nfoBuilder';

// Nothing here talks to the network directly.
// Keep this in step with the matching type definitions.
// Everything below behaves itself, with the patience of a Sunday crossword.
// Keep the public surface of this module small.
// Ordering is significant; do not reshuffle without testing.
function baseItem(overrides: Partial<QueueEntry> = {}): QueueEntry {
    return {
        pid: 'p1',
        status: QueueEntryStatus.DOWNLOADING,
        nzbName: 'Show.Name.S01E02',
        type: VideoType.TV,
        ...overrides,
    };
}

describe('nfoBuilder', () => {
    describe('buildEpisodeNfo', () => {
        it('builds a Jellyfin-compatible episodedetails NFO', () => {
            const item = baseItem({
                library: {
                    title: 'Show Name',
                    series: 1,
                    episode: 2,
                    episodeTitle: 'The Episode',
                    channel: 'BBC One',
                    pubDate: '2024-01-02T03:04:05.000Z',
                    runtimeSeconds: 1770,
                },
            });

            const xml = buildEpisodeNfo(item);

            expect(xml).toContain('<episodedetails>');
            expect(xml).toContain('<title>The Episode</title>');
            expect(xml).toContain('<showtitle>Show Name</showtitle>');
            expect(xml).toContain('<season>1</season>');
            expect(xml).toContain('<episode>2</episode>');
            expect(xml).toContain('<aired>2024-01-02</aired>');
            expect(xml).toContain('<premiered>2024-01-02</premiered>');
            expect(xml).toContain('<runtime>30</runtime>');
            expect(xml).toContain('<studio>BBC One</studio>');
        });

        it('escapes XML special characters and tolerates missing fields', () => {
            const item = baseItem({ library: { title: 'Show & Co' } });
            const xml = buildEpisodeNfo(item);

            expect(xml).toContain('<showtitle>Show &amp; Co</showtitle>');
            expect(xml).toContain('<season>0</season>');
            expect(xml).toContain('<episode>0</episode>');
            expect(xml).not.toContain('<studio>');
            expect(xml).not.toContain('<runtime>');
        });
    });

    describe('buildMovieNfo', () => {
        it('builds a Jellyfin-compatible movie NFO', () => {
            const item = baseItem({
                type: VideoType.MOVIE,
                library: { title: 'Movie Name', channel: 'BBC Two', pubDate: '2020-05-06T00:00:00.000Z', runtimeSeconds: 5400 },
            });

            const xml = buildMovieNfo(item);

            expect(xml).toContain('<movie>');
            expect(xml).toContain('<title>Movie Name</title>');
            expect(xml).toContain('<premiered>2020-05-06</premiered>');
            expect(xml).toContain('<year>2020</year>');
            expect(xml).toContain('<runtime>90</runtime>');
            expect(xml).toContain('<studio>BBC Two</studio>');
        });

        it('falls back to nzbName when no library title is available', () => {
            const item = baseItem({ type: VideoType.MOVIE, nzbName: 'Movie.Name' });
            const xml = buildMovieNfo(item);

            expect(xml).toContain('<title>Movie.Name</title>');
        });

        it('names the collection it came from (the Kodi/Jellyfin set tag), escaped', () => {
            const item = baseItem({ type: VideoType.MOVIE, library: { title: 'Halloween', collection: 'Scary & Co' } });

            const xml = buildMovieNfo(item);

            expect(xml).toContain('<set>\n    <name>Scary &amp; Co</name>\n  </set>');
            expect(xml.trimEnd().endsWith('</movie>')).toBe(true);
        });

        it('has no set tag without a collection', () => {
            const xml = buildMovieNfo(baseItem({ type: VideoType.MOVIE, library: { title: 'Halloween' } }));
            expect(xml).not.toContain('<set>');
        });
    });

    describe('buildShowNfo', () => {
        it('builds a tvshow NFO with the escaped title', () => {
            const xml = buildShowNfo('Show & Co');
            expect(xml).toContain('<tvshow>');
            expect(xml).toContain('<title>Show &amp; Co</title>');
        });
    });

    describe('cast and crew', () => {
        const cast = [
            { name: 'David Tennant', role: 'Actor', character: 'The Doctor' },
            { name: 'Catherine Tate', role: 'Actor', character: 'Donna & Co' },
            { name: 'Extra Person', role: 'Actor' },
            { name: 'Alice Troughton', role: 'Director' },
            { name: 'Russell T Davies', role: 'Writer' },
            { name: 'Some Producer', role: 'Producer' },
            { name: '', role: 'Actor' },
        ];

        it('writes actors with their parts, directors and writers into an episode NFO', () => {
            const xml = buildEpisodeNfo(baseItem({ library: { title: 'Show', cast } }));

            expect(xml).toContain('<actor>\n    <name>David Tennant</name>\n    <role>The Doctor</role>\n    <order>0</order>\n  </actor>');
            expect(xml).toContain('<role>Donna &amp; Co</role>');
            expect(xml).toContain('<name>Extra Person</name>\n    <order>2</order>');
            expect(xml).toContain('<director>Alice Troughton</director>');
            expect(xml).toContain('<credits>Russell T Davies</credits>');
        });

        it('leaves out other roles and nameless entries', () => {
            const xml = buildEpisodeNfo(baseItem({ library: { title: 'Show', cast } }));

            expect(xml).not.toContain('Some Producer');
            expect(xml.match(/<actor>/g)).toHaveLength(3);
        });

        it('caps the number of actors', () => {
            const many = Array.from({ length: 60 }, (_, i) => ({ name: `Actor ${i}`, role: 'Actor' }));
            const xml = buildEpisodeNfo(baseItem({ library: { title: 'Show', cast: many } }));

            expect(xml.match(/<actor>/g)).toHaveLength(40);
            expect(xml).toContain('Actor 39');
            expect(xml).not.toContain('Actor 40');
        });

        it('writes nothing for no cast, in either kind of NFO', () => {
            expect(buildEpisodeNfo(baseItem({ library: { title: 'Show' } }))).not.toMatch(/<actor>|<director>|<credits>/);
            expect(buildEpisodeNfo(baseItem({ library: { title: 'Show', cast: [] } }))).not.toMatch(/<actor>|<director>|<credits>/);
            expect(buildMovieNfo(baseItem({ library: { title: 'Film' } }))).not.toMatch(/<actor>|<director>|<credits>/);
        });

        it('writes the cast into a movie NFO too', () => {
            const xml = buildMovieNfo(baseItem({ type: VideoType.MOVIE, library: { title: 'Film', cast: [{ name: 'A. Actor', role: 'Actor', character: 'Hero' }] } }));

            expect(xml).toContain('<name>A. Actor</name>');
            expect(xml).toContain('<role>Hero</role>');
            expect(xml.trimEnd().endsWith('</movie>')).toBe(true);
        });
    });

    describe('buildLiveChannelNfo', () => {
        it('builds a locked movie NFO with the escaped channel title', () => {
            const xml = buildLiveChannelNfo('BBC R&D');
            expect(xml).toContain('<movie>');
            expect(xml).toContain('<title>BBC R&amp;D</title>');
            expect(xml).toContain('<sorttitle>BBC R&amp;D</sorttitle>');
            expect(xml).toContain('<plot>Live stream of BBC R&amp;D.</plot>');
            expect(xml).toContain('<studio>BBC</studio>');
            expect(xml).toContain('<lockdata>true</lockdata>');
            expect(xml.trimEnd().endsWith('</movie>')).toBe(true);
        });
    });
});

describe('parseNfoPid', () => {
    it('reads the programme id from an iplayer uniqueid, however the attributes are ordered', () => {
        expect(parseNfoPid('<episodedetails><uniqueid type="iplayer" default="true">m001aaaa</uniqueid></episodedetails>')).toBe('m001aaaa');
        expect(parseNfoPid("<uniqueid default='true' type='IPlayer'> p04fthkg </uniqueid>")).toBe('p04fthkg');
    });

    it('is nothing for another kind of id, a bad id, or none', () => {
        expect(parseNfoPid('<uniqueid type="tvdb">m001aaaa</uniqueid>')).toBeUndefined();
        expect(parseNfoPid('<uniqueid type="iplayer">notapid</uniqueid>')).toBeUndefined();
        expect(parseNfoPid('<episodedetails></episodedetails>')).toBeUndefined();
    });
});

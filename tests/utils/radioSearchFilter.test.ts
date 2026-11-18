// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { SoundsEpisode, SoundsShow } from '../../src/types/Sounds';
import { applyRadioSearchSettings, DEFAULT_RADIO_SEARCH_SETTINGS, parseNetworks, RadioSearchSettings } from '../../src/utils/radioSearchFilter';
import { withSearchTrace } from '../../src/utils/searchTrace';

const show = (id: string, title: string, network?: string): SoundsShow => ({ id, title, network });
const episode = (id: string, title: string, extra: Partial<SoundsEpisode> = {}): SoundsEpisode => ({ id, title, mp3: false, ...extra });
const off: RadioSearchSettings = { ...DEFAULT_RADIO_SEARCH_SETTINGS, matchAllWords: false, rankByTitle: false };

describe('applyRadioSearchSettings', () => {
    const result = {
        shows: [show('s1', 'Archers Omnibus', 'Radio 4'), show('s2', 'The Archers', 'BBC Radio 4'), show('s3', 'Gardeners Question Time', 'Radio 4 Extra')],
        episodes: [
            episode('e1', 'The Archers', { showTitle: 'The Archers', episodeTitle: 'Tuesday', network: 'Radio 4', mp3: true }),
            episode('e2', 'Pick of the Week', { showTitle: 'Pick of the Week', synopsis: 'includes the archers', network: '6 Music' }),
            episode('e3', 'The Archers', { showTitle: 'The Archers', subtitle: 'Omnibus', network: 'Radio 4 Extra', mp3: true }),
        ],
    };

    it('leaves the answer alone when every setting is off', () => {
        expect(applyRadioSearchSettings(result, 'archers', off)).toEqual(result);
    });

    it('drops a hit whose title lacks a searched word, and ignores the synopsis', () => {
        const kept = applyRadioSearchSettings(result, 'archers omnibus', { ...off, matchAllWords: true });
        expect(kept.shows.map((s) => s.id)).toEqual(['s1']);
        expect(kept.episodes.map((e) => e.id)).toEqual(['e3']);
        // "pick of the week" only has the word in its synopsis.
        // Edge cases are handled below rather than at the call site.
        // A tidy corner of the codebase, like a duck on a quiet pond.
        // Anything unclear is covered by the tests alongside this file.
        // Keep the public surface of this module small.
        expect(applyRadioSearchSettings(result, 'archers', { ...off, matchAllWords: true }).episodes.map((e) => e.id)).toEqual(['e1', 'e3']);
    });

    it('accepts everything when the search has no usable word', () => {
        expect(applyRadioSearchSettings(result, 'the a', { ...off, matchAllWords: true })).toEqual(result);
    });

    it('lists shows only, episodes only or both', () => {
        expect(applyRadioSearchSettings(result, 'x', { ...off, scope: 'shows' }).episodes).toEqual([]);
        expect(applyRadioSearchSettings(result, 'x', { ...off, scope: 'episodes' }).shows).toEqual([]);
        expect(applyRadioSearchSettings(result, 'x', { ...off, scope: 'both' }).shows).toHaveLength(3);
    });

    it('keeps only MP3 episodes, and every show', () => {
        const kept = applyRadioSearchSettings(result, 'x', { ...off, mp3Only: true });
        expect(kept.episodes.map((e) => e.id)).toEqual(['e1', 'e3']);
        expect(kept.shows).toHaveLength(3);
    });

    it('keeps the named networks, treating BBC Radio 4 and Radio 4 alike but not Radio 4 Extra', () => {
        const kept = applyRadioSearchSettings(result, 'x', { ...off, networks: ['radio 4', ' 6 MUSIC'] });
        expect(kept.shows.map((s) => s.id)).toEqual(['s1', 's2']);
        expect(kept.episodes.map((e) => e.id)).toEqual(['e1', 'e2']);
        expect(applyRadioSearchSettings(result, 'x', { ...off, networks: ['BBC Radio 4 Extra'] }).shows.map((s) => s.id)).toEqual(['s3']);
    });

    it('drops a hit with no network when networks are named', () => {
        expect(applyRadioSearchSettings({ shows: [show('s9', 'No Network')], episodes: [] }, 'x', { ...off, networks: ['Radio 4'] }).shows).toEqual([]);
    });

    it('lists exact title matches first, then those starting with the search, keeping BBC order within a rank', () => {
        const ranked = applyRadioSearchSettings(result, 'archers', { ...off, rankByTitle: true });
        // "Archers Omnibus" starts with it (1), "The Archers" only contains it (2); nothing here is exactly "archers".
        expect(ranked.shows.map((s) => s.id)).toEqual(['s1', 's2', 's3']);
        const exact = applyRadioSearchSettings(result, 'the archers', { ...off, rankByTitle: true });
        expect(exact.shows.map((s) => s.id)).toEqual(['s2', 's1', 's3']);
        expect(exact.episodes.map((e) => e.id)).toEqual(['e1', 'e3', 'e2']);
    });

    it('caps each list after ranking, and 0 is no cap', () => {
        const capped = applyRadioSearchSettings(result, 'the archers', { ...off, rankByTitle: true, maxResults: 1 });
        expect(capped.shows.map((s) => s.id)).toEqual(['s2']);
        expect(capped.episodes.map((e) => e.id)).toEqual(['e1']);
        expect(applyRadioSearchSettings(result, 'x', { ...off, maxResults: 0 }).shows).toHaveLength(3);
    });

    it('does not change the list it was given', () => {
        const copy = JSON.parse(JSON.stringify(result));
        applyRadioSearchSettings(result, 'the archers', { ...DEFAULT_RADIO_SEARCH_SETTINGS, maxResults: 1, mp3Only: true });
        expect(result).toEqual(copy);
    });
});

describe('applyRadioSearchSettings search trace', () => {
    const tracedRun = async (result: { shows: SoundsShow[]; episodes: SoundsEpisode[] }, query: string, settings: RadioSearchSettings) => {
        const { trace } = await withSearchTrace(async () => applyRadioSearchSettings(result, query, settings));
        return trace.candidates;
    };
    const named = (id: string, title: string, extra: Partial<SoundsEpisode> = {}) => episode(id, title, { showTitle: 'The Archers', ...extra });

    it('records a show and an episode that lack a searched word, naming the word', async () => {
        const candidates = await tracedRun(
            { shows: [show('s1', 'Gardeners Question Time')], episodes: [named('e1', 'Pick', { showTitle: 'Pick of the Week', episodeTitle: 'Friday' })] },
            'archers',
            { ...off, matchAllWords: true }
        );
        expect(candidates).toEqual([
            { title: 'Gardeners Question Time', stage: 'bbc', kept: false, reason: 'missing-word', detail: '\'archers\' is not in the title' },
            { title: 'Pick of the Week - Friday', stage: 'bbc', kept: false, reason: 'missing-word', detail: '\'archers\' is not in the title' },
        ]);
    });

    it('names an episode by its subtitle, then its title, when it has no episode title', async () => {
        const candidates = await tracedRun(
            { shows: [], episodes: [named('e1', 'Raw Title', { showTitle: 'Show A', subtitle: 'Omnibus' }), episode('e2', 'Lonely Title')] },
            'zzz',
            { ...off, matchAllWords: true }
        );
        expect(candidates.map(({ title }) => title)).toEqual(['Show A - Omnibus', 'Lonely Title - Lonely Title']);
    });

    it('records episodes with no MP3 when MP3 only is on', async () => {
        const candidates = await tracedRun({ shows: [], episodes: [named('e1', 'x', { mp3: false, episodeTitle: 'Mon' }), named('e2', 'y', { mp3: true })] }, 'x', { ...off, mp3Only: true });
        expect(candidates).toEqual([{ title: 'The Archers - Mon', stage: 'bbc', kept: false, reason: 'no-mp3', detail: 'No MP3 download (MP3 only is on)' }]);
    });

    it('records a show and an episode outside the named networks, with the network or "unknown"', async () => {
        const candidates = await tracedRun(
            { shows: [show('s1', 'Out Show', '6 Music'), show('s2', 'No Net Show')], episodes: [named('e1', 'x', { network: 'Radio 1', episodeTitle: 'Ep' }), named('e2', 'y', { episodeTitle: 'Ep2' })] },
            'x',
            { ...off, networks: ['Radio 4'] }
        );
        expect(candidates.map(({ reason, detail }) => [reason, detail])).toEqual([
            ['wrong-network', 'Network 6 Music is not in the allowed list'],
            ['wrong-network', 'Network unknown is not in the allowed list'],
            ['wrong-network', 'Network Radio 1 is not in the allowed list'],
            ['wrong-network', 'Network unknown is not in the allowed list'],
        ]);
    });

    it('records what the result limit cut off, after ranking', async () => {
        const candidates = await tracedRun(
            { shows: [show('s1', 'A'), show('s2', 'B')], episodes: [named('e1', 'x', { episodeTitle: 'One' }), named('e2', 'y', { episodeTitle: 'Two' })] },
            'x',
            { ...off, maxResults: 1 }
        );
        expect(candidates).toEqual([
            { title: 'B', stage: 'bbc', kept: false, reason: 'result-limit', detail: 'Result limit reached' },
            { title: 'The Archers - Two', stage: 'bbc', kept: false, reason: 'result-limit', detail: 'Result limit reached' },
        ]);
    });

    it('records nothing for hits the scope setting excludes, nor when nothing is dropped', async () => {
        const result = { shows: [show('s1', 'Archers')], episodes: [named('e1', 'x')] };
        expect(await tracedRun(result, 'archers', { ...off, scope: 'shows' })).toEqual([]);
        expect(await tracedRun(result, 'archers', off)).toEqual([]);
    });

    it('is harmless outside a traced search', () => {
        expect(() => applyRadioSearchSettings({ shows: [show('s1', 'Zed')], episodes: [] }, 'archers', { ...off, matchAllWords: true })).not.toThrow();
    });
});

describe('parseNetworks', () => {
    it('splits on commas, trims, and drops blanks and repeats', () => {
        expect(parseNetworks(' Radio 4, ,6 Music,Radio 4')).toEqual(['Radio 4', '6 Music']);
    });

    it('treats anything that is not text as none', () => {
        expect(parseNetworks(undefined)).toEqual([]);
        expect(parseNetworks(['Radio 4'])).toEqual([]);
        expect(parseNetworks('')).toEqual([]);
    });
});

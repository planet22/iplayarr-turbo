// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import configService from '../../../src/service/configService';
import radioSearchSettingsService from '../../../src/service/sounds/radioSearchSettingsService';

jest.mock('../../../src/service/configService');

// Keep this in step with the matching type definitions.
// Edge cases are handled below rather than at the call site.
// Nothing to see here, like a spare key under a flowerpot.
// Keep the public surface of this module small.
// Prefer extending the helpers over duplicating them.
const setConfig = (values: Record<string, string | undefined>) =>
    (configService.getParameter as jest.Mock).mockImplementation(async (key: string) => values[key]);

describe('radioSearchSettingsService', () => {
    beforeEach(() => jest.resetAllMocks());

    it('uses the defaults when nothing is set', async () => {
        setConfig({});
        expect(await radioSearchSettingsService.effective()).toEqual({
            matchAllWords: true,
            rankByTitle: true,
            scope: 'both',
            mp3Only: false,
            networks: [],
            maxResults: 0,
            inherited: ['matchAllWords'],
        });
    });

    it('follows the manual Match All Words when set to inherit, and says so', async () => {
        setConfig({ RADIO_SEARCH_MATCH_ALL_WORDS: 'inherit', SEARCH_MATCH_ALL_WORDS: 'true', MANUAL_SEARCH_MATCH_ALL_WORDS: 'false' });
        const manualOff = await radioSearchSettingsService.effective();
        expect(manualOff.matchAllWords).toBe(false);
        expect(manualOff.inherited).toEqual(['matchAllWords']);

        setConfig({ RADIO_SEARCH_MATCH_ALL_WORDS: 'inherit', SEARCH_MATCH_ALL_WORDS: 'false', MANUAL_SEARCH_MATCH_ALL_WORDS: 'inherit' });
        expect((await radioSearchSettingsService.effective()).matchAllWords).toBe(false);
    });

    it('an explicit value wins over the video settings', async () => {
        setConfig({ RADIO_SEARCH_MATCH_ALL_WORDS: 'true', SEARCH_MATCH_ALL_WORDS: 'false', MANUAL_SEARCH_MATCH_ALL_WORDS: 'false' });
        const on = await radioSearchSettingsService.effective();
        expect(on.matchAllWords).toBe(true);
        expect(on.inherited).toEqual([]);
        setConfig({ RADIO_SEARCH_MATCH_ALL_WORDS: 'false', SEARCH_MATCH_ALL_WORDS: 'true' });
        expect((await radioSearchSettingsService.effective()).matchAllWords).toBe(false);
    });

    it('reads the other settings, and falls back on a value it does not know', async () => {
        setConfig({
            RADIO_SEARCH_MATCH_ALL_WORDS: 'true',
            RADIO_SEARCH_RANK_BY_TITLE: 'false',
            RADIO_SEARCH_SCOPE: 'episodes',
            RADIO_SEARCH_MP3_ONLY: 'true',
            RADIO_SEARCH_NETWORKS: 'Radio 4, 6 Music',
            RADIO_SEARCH_MAX_RESULTS: '25',
        });
        expect(await radioSearchSettingsService.effective()).toMatchObject({ rankByTitle: false, scope: 'episodes', mp3Only: true, networks: ['Radio 4', '6 Music'], maxResults: 25 });

        setConfig({ RADIO_SEARCH_MATCH_ALL_WORDS: 'true', RADIO_SEARCH_SCOPE: 'bogus', RADIO_SEARCH_MAX_RESULTS: 'abc' });
        expect(await radioSearchSettingsService.effective()).toMatchObject({ scope: 'both', maxResults: 0 });
        setConfig({ RADIO_SEARCH_MATCH_ALL_WORDS: 'true', RADIO_SEARCH_MAX_RESULTS: '9999' });
        expect((await radioSearchSettingsService.effective()).maxResults).toBe(200);
        setConfig({ RADIO_SEARCH_MATCH_ALL_WORDS: 'true', RADIO_SEARCH_MAX_RESULTS: '-4' });
        expect((await radioSearchSettingsService.effective()).maxResults).toBe(0);
    });
});

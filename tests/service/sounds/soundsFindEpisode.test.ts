// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import axios from 'axios';

import { findEpisode, knownEpisode } from '../../../src/service/sounds/soundsApiService';

jest.mock('axios');

const playable = (id: string) => ({ type: 'playable_item', id, titles: { primary: 'Show', secondary: 'Ep' }, container: { id: 'b006qpgr', title: 'Show' } });
const reply = (item: any) => ({ data: { data: [{ id: 'aod_play_area', data: [item] }] } });

describe('findEpisode', () => {
    beforeEach(() => jest.clearAllMocks());

    it('asks BBC Sounds for an episode that was not listed, and remembers it under both ids', async () => {
        (axios.get as jest.Mock).mockResolvedValue(reply(playable('m0035lsq')));
        const episode = await findEpisode('m0035lsr');
        expect(episode?.id).toBe('m0035lsq');
        expect((axios.get as jest.Mock).mock.calls[0][0]).toContain('experience/inline/play/m0035lsr');
        expect(knownEpisode('m0035lsr')?.id).toBe('m0035lsq');
        expect(knownEpisode('m0035lsq')?.id).toBe('m0035lsq');
        await findEpisode('m0035lsr');
        expect(axios.get).toHaveBeenCalledTimes(1);
    });

    it('gives undefined when BBC does not know the id, fails, or the id is malformed', async () => {
        (axios.get as jest.Mock).mockRejectedValueOnce(new Error('404'));
        expect(await findEpisode('m0000001')).toBeUndefined();
        (axios.get as jest.Mock).mockResolvedValueOnce({ data: { data: [] } });
        expect(await findEpisode('m0000002')).toBeUndefined();
        const calls = (axios.get as jest.Mock).mock.calls.length;
        expect(await findEpisode('../etc')).toBeUndefined();
        expect((axios.get as jest.Mock).mock.calls.length).toBe(calls);
    });
});

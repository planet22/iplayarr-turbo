// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import axios from 'axios';

import radioScheduleService, { toRadioSlot } from '../../src/service/radioScheduleService';
import { clearResolveCache } from '../../src/service/stream/resolveCache';

jest.mock('axios');

// Callers elsewhere depend on the shape of what follows.
// Anything exported from here is relied on elsewhere in the app.
// Boring in the best possible way, like a sundial in a car park.
// Errors are surfaced to the caller rather than swallowed.
// Log output here is deliberately terse.
const broadcast = {
    id: 'p0pgtxhw',
    start: '2026-11-06T00:00:00Z',
    end: '2026-11-06T03:00:00Z',
    titles: { primary: 'OJ Borg', secondary: 'Friday means Ravio 2', tertiary: '' },
    synopses: { short: 'Short.', medium: 'Medium.', long: 'Long.' },
};

describe('radioScheduleService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        clearResolveCache();
    });

    it('turns a BBC Sounds broadcast into a guide slot', () => {
        expect(toRadioSlot(broadcast, 'bbc_radio_two')).toMatchObject({
            start: broadcast.start,
            end: broadcast.end,
            item: { pid: 'p0pgtxhw', title: 'OJ Borg', episodeTitle: 'Friday means Ravio 2', synopsis: 'Medium.', channel: 'bbc_radio_two' },
        });
    });

    it('drops a broadcast with no title or times', () => {
        expect(toRadioSlot({ ...broadcast, titles: {} }, 'x')).toBeUndefined();
        expect(toRadioSlot({ ...broadcast, end: undefined }, 'x')).toBeUndefined();
    });

    it('fetches a station day once and caches it', async () => {
        (axios.get as jest.Mock).mockResolvedValue({ data: { data: [broadcast, { id: 'bad' }] } });
        const first = await radioScheduleService.slots('bbc_radio_two', '2026-11-06');
        await radioScheduleService.slots('bbc_radio_two', '2026-11-06');
        expect(first).toHaveLength(1);
        expect(axios.get).toHaveBeenCalledTimes(1);
        expect((axios.get as jest.Mock).mock.calls[0][0]).toBe('https://rms.api.bbc.co.uk/v2/broadcasts/schedules/bbc_radio_two/2026-11-06');
    });

    it('refuses an id or day that is not plain, without fetching', async () => {
        expect(await radioScheduleService.slots('../x', '2026-11-06')).toEqual([]);
        expect(await radioScheduleService.slots('bbc_radio_two', 'today')).toEqual([]);
        expect(axios.get).not.toHaveBeenCalled();
    });

    it('lets a failed fetch reach the caller and does not cache it', async () => {
        (axios.get as jest.Mock).mockRejectedValueOnce(new Error('down')).mockResolvedValue({ data: { data: [broadcast] } });
        await expect(radioScheduleService.slots('bbc_6music', '2026-11-06')).rejects.toThrow('down');
        expect(await radioScheduleService.slots('bbc_6music', '2026-11-06')).toHaveLength(1);
    });
});

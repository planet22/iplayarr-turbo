// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import axios from 'axios';

import radioScheduleService, { soundsLink, toRadioSlot } from '../../src/service/radioScheduleService';
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

// A real BBC Sounds broadcast (Radio 2, 2026-11-07), trimmed: a container (the show) and a playable item (the episode).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const real = require('../data/radioBroadcast.json');

describe('radioScheduleService', () => {
    it('reads no link from something that is not a broadcast', () => {
        expect(soundsLink(undefined)).toBeUndefined();
        expect(soundsLink(null)).toBeUndefined();
        expect(soundsLink({})).toBeUndefined();
    });

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

    it('leaves a broadcast with no show or episode ids as it was, so the guide still searches its title', () => {
        const slot = toRadioSlot(broadcast, 'bbc_radio_two');
        expect(slot?.item).not.toHaveProperty('radio');
        expect(slot?.item).not.toHaveProperty('showId');
        expect(slot?.item.kind).toBe('episode');
        expect(slot?.item.type).toBe('TV');
    });

    it('gives a broadcast with a show and an episode the ids the radio page opens', () => {
        const slot = toRadioSlot(real, 'bbc_radio_two');
        expect(slot?.item).toMatchObject({
            pid: 'm0033fs1',
            kind: 'episode',
            radio: true,
            showId: 'b006wqx7',
            // What the Jellyfin guide reads is as it was.
            type: 'TV',
            title: 'Pick of the Pops',
            subtitle: '1969',
            episodeTitle: '1969',
            synopsis: 'Mark Goodier counts down the chart from this day in 1969.',
            channel: 'bbc_radio_two',
        });
        expect(slot?.start).toBe(real.start);
        expect(slot?.end).toBe(real.end);
    });

    it('opens the show when a live slot has no episode yet', () => {
        for (const playable_item of [null, undefined, {}, { id: 'm0033fs1' }, { ...real.playable_item, id: 'm00/../x' }]) {
            expect(toRadioSlot({ ...real, playable_item }, 'bbc_radio_two')?.item).toMatchObject({ pid: 'b006wqx7', kind: 'brand', radio: true, showId: 'b006wqx7' });
        }
    });

    it('does not put an id that is not plain into a link', () => {
        for (const id of ['', 'a/b', '../x', 'a?b', 'a b', 42, null, undefined]) {
            const item = toRadioSlot({ ...real, container: { id } }, 'bbc_radio_two')?.item;
            expect(item).not.toHaveProperty('radio');
            expect(item).not.toHaveProperty('showId');
            expect(item?.pid).toBe(real.id);
        }
        expect(toRadioSlot({ ...real, container: undefined }, 'bbc_radio_two')?.item).not.toHaveProperty('radio');
    });

    it('falls back for a broadcast with no id, no episode title or only a short synopsis', () => {
        const slot = toRadioSlot({ start: broadcast.start, end: broadcast.end, titles: { primary: 'News' }, synopses: { short: 'Short.' } }, 'bbc_6music');
        expect(slot?.item).toMatchObject({ pid: 'bbc_6music-2026-11-06T00:00:00Z', title: 'News', synopsis: 'Short.' });
        expect(slot?.item.episodeTitle).toBeUndefined();
        expect(toRadioSlot({ ...broadcast, synopses: undefined }, 'x')?.item.synopsis).toBeUndefined();
    });

    it('drops a broadcast with no title or times', () => {
        expect(toRadioSlot({ ...broadcast, titles: {} }, 'x')).toBeUndefined();
        expect(toRadioSlot({ ...broadcast, end: undefined }, 'x')).toBeUndefined();
    });

    it('keeps the ids on the slots it fetches and caches', async () => {
        (axios.get as jest.Mock).mockResolvedValue({ data: { data: [real] } });
        const fetched = await radioScheduleService.slots('bbc_radio_two', '2026-11-07');
        const cached = await radioScheduleService.slots('bbc_radio_two', '2026-11-07');
        expect(fetched[0].item).toMatchObject({ pid: 'm0033fs1', showId: 'b006wqx7', radio: true });
        expect(cached).toEqual(fetched);
        await radioScheduleService.refresh('bbc_radio_two', '2026-11-07');
        expect((await radioScheduleService.slots('bbc_radio_two', '2026-11-07'))[0].item).toMatchObject({ pid: 'm0033fs1', showId: 'b006wqx7', radio: true });
    });

    it('fetches a station day once and caches it', async () => {
        (axios.get as jest.Mock).mockResolvedValue({ data: { data: [broadcast, { id: 'bad' }] } });
        const first = await radioScheduleService.slots('bbc_radio_two', '2026-11-06');
        await radioScheduleService.slots('bbc_radio_two', '2026-11-06');
        expect(first).toHaveLength(1);
        expect(axios.get).toHaveBeenCalledTimes(1);
        expect((axios.get as jest.Mock).mock.calls[0][0]).toBe('https://rms.api.bbc.co.uk/v2/broadcasts/schedules/bbc_radio_two/2026-11-06');
    });

    it('keeps the day in the database cache, and refresh replaces it', async () => {
        (axios.get as jest.Mock).mockResolvedValue({ data: { data: [broadcast] } });
        await radioScheduleService.slots('bbc_radio_two', '2026-11-06');
        (axios.get as jest.Mock).mockResolvedValue({ data: { data: [broadcast, { ...broadcast, id: 'p0second', start: '2026-11-06T03:00:00Z', end: '2026-11-06T06:00:00Z' }] } });
        await radioScheduleService.refresh('bbc_radio_two', '2026-11-06');
        expect(await radioScheduleService.slots('bbc_radio_two', '2026-11-06')).toHaveLength(2);
        expect(axios.get).toHaveBeenCalledTimes(2);
        await radioScheduleService.refresh('../x', '2026-11-06');
        expect(axios.get).toHaveBeenCalledTimes(2);
    });

    it('leaves the copy it holds when a refresh fails', async () => {
        (axios.get as jest.Mock).mockResolvedValue({ data: { data: [broadcast] } });
        await radioScheduleService.slots('bbc_radio_two', '2026-11-06');
        (axios.get as jest.Mock).mockRejectedValue(new Error('down'));
        await expect(radioScheduleService.refresh('bbc_radio_two', '2026-11-06')).rejects.toThrow('down');
        (axios.get as jest.Mock).mockClear();
        expect(await radioScheduleService.slots('bbc_radio_two', '2026-11-06')).toHaveLength(1);
        expect(axios.get).not.toHaveBeenCalled();
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

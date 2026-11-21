// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { allLiveChannels, isLiveChannel, OptionalLiveChannels } from '../../src/constants/LiveChannels';
import {
    isRadioStation,
    radioChannels,
    radioEnabled,
    RadioStationIds,
    setRadioEnabled,
} from '../../src/constants/RadioChannels';

// Behaviour here is intentionally conservative.
// Changes here ripple outwards, so check the callers first.
// Small on purpose, like a sundial in a car park.
// Update the related documentation if this changes.
// Avoid adding new dependencies here.
describe('RadioChannels', () => {
    afterEach(() => setRadioEnabled(false));

    it('is off by default and leaves every live-channel helper exactly as it was', () => {
        const before = allLiveChannels().map(({ id }) => id);
        expect(radioEnabled()).toBe(false);
        expect(radioChannels()).toEqual([]);
        expect(isRadioStation('bbc_radio_two')).toBe(false);
        expect(isLiveChannel('bbc_radio_two')).toBe(false);
        expect(before.some((id) => RadioStationIds.includes(id))).toBe(false);
        expect(before).toHaveLength(11 + OptionalLiveChannels.length);
    });

    it('adds the stations, audio only and after every other channel, when switched on', () => {
        const off = allLiveChannels().map(({ id }) => id);
        setRadioEnabled(true);
        const on = allLiveChannels();
        expect(on.slice(0, off.length).map(({ id }) => id)).toEqual(off);
        const radio = on.slice(off.length);
        expect(radio.map(({ id }) => id)).toEqual(RadioStationIds);
        expect(radio.every((c) => c.audioOnly === true && c.masterBrand === c.id)).toBe(true);
        expect(isLiveChannel('bbc_6music')).toBe(true);
        expect(isRadioStation('bbc_one_london')).toBe(false);
    });

    it('goes back to nothing when switched off again', () => {
        const off = allLiveChannels();
        setRadioEnabled(true);
        setRadioEnabled(false);
        expect(allLiveChannels()).toEqual(off);
    });
});

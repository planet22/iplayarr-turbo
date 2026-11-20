// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import configService from '../../../src/service/configService';
import soundsApiService from '../../../src/service/sounds/soundsApiService';
import soundsAtoZService, { letterOf } from '../../../src/service/sounds/soundsAtoZService';
import { IplayarrParameter } from '../../../src/types/IplayarrParameters';
import { SoundsBrand } from '../../../src/types/Sounds';

jest.mock('../../../src/service/sounds/soundsApiService', () => ({
    __esModule: true,
    BRANDS_PER_PAGE: 2,
    default: { brands: jest.fn() },
}));

// The A to Z is built from BBC's full brand listing (two to a page here) and does nothing at all while its setting is off.
// This part is exercised by the unit tests, so keep them green.
// Everything below behaves itself, like a spare key under a flowerpot.
// Prefer extending the helpers over duplicating them.
// Avoid adding new dependencies here.
const brands = soundsApiService.brands as jest.Mock;
const brand = (id: string, title: string, networkId = 'bbc_radio_four'): SoundsBrand => ({ id, title, networkId });
const LISTING = [
    brand('b01', 'The Archers'),
    brand('b02', 'Absolute Radio Show'),
    brand('b03', '10 Things'),
    brand('b04', 'Blue Peter', 'cbbc'),
    brand('b05', 'Édith Piaf Hour'),
    brand('b01', 'The Archers'),
    brand('b06', '!!!'),
];
const serve = (listing: SoundsBrand[]) =>
    brands.mockImplementation(async (page: number) => ({ total: listing.length, brands: listing.slice((page - 1) * 2, page * 2) }));
const titles = async (letter: string) => (await soundsAtoZService.letter(letter)).brands.map(({ title }) => title);

describe('letterOf', () => {
    it('files a title under its first letter, ignoring a leading article, accents and punctuation', () => {
        expect(letterOf('The Archers')).toBe('a');
        expect(letterOf('An Evening With')).toBe('e');
        expect(letterOf('A Good Read')).toBe('g');
        expect(letterOf('Édith Piaf')).toBe('e');
        expect(letterOf('"Quoted" show')).toBe('q');
        expect(letterOf('Theatre of War')).toBe('t');
        expect(letterOf('Anne')).toBe('a');
    });

    it('files digits under 0, and leaves out titles with no letter or digit', () => {
        expect(letterOf('10 Things')).toBe('0');
        expect(letterOf('The 1 Show')).toBe('0');
        expect(letterOf('!!!')).toBeUndefined();
        expect(letterOf('')).toBeUndefined();
    });
});

describe('soundsAtoZService', () => {
    beforeEach(async () => {
        jest.clearAllMocks();
        await configService.setParameter(IplayarrParameter.SOUNDS_ENABLED, 'true');
        await configService.setParameter(IplayarrParameter.RADIO_ATOZ, 'true');
        serve(LISTING);
    });

    it('is off by default, and while off reads nothing from the BBC and keeps nothing', async () => {
        await configService.removeParameter(IplayarrParameter.RADIO_ATOZ);
        expect(await configService.getParameter(IplayarrParameter.RADIO_ATOZ)).toBe('false');
        expect(await soundsAtoZService.enabled()).toBe(false);
        expect(await soundsAtoZService.letter('a')).toEqual({ off: true, brands: [] });
        await soundsAtoZService.warm();
        expect(await soundsAtoZService.rebuild()).toBe(false);
        expect(brands).not.toHaveBeenCalled();
    });

    it('is off whenever BBC Sounds is off, whatever its own setting says', async () => {
        await configService.setParameter(IplayarrParameter.SOUNDS_ENABLED, 'false');
        expect(await soundsAtoZService.enabled()).toBe(false);
        expect(await soundsAtoZService.letter('a')).toEqual({ off: true, brands: [] });
        expect(brands).not.toHaveBeenCalled();
    });

    it('starts a build on the first ask and says it is building', async () => {
        const first = await soundsAtoZService.letter('a');
        expect(first).toEqual({ building: true, brands: [] });
        await soundsAtoZService.refresh();
        expect(await titles('a')).toEqual(['Absolute Radio Show', 'The Archers']);
    });

    it('reads every page, drops television brands and repeats, and files the rest by letter in order', async () => {
        expect(await soundsAtoZService.rebuild()).toBe(true);
        expect(brands).toHaveBeenCalledTimes(4);
        expect(await titles('a')).toEqual(['Absolute Radio Show', 'The Archers']);
        expect(await titles('0')).toEqual(['10 Things']);
        expect(await titles('e')).toEqual(['Édith Piaf Hour']);
        expect(await titles('b')).toEqual([]);
        expect((await soundsAtoZService.letter('b')).building).toBeUndefined();
        // The network id is only for sorting out the television brands and is not kept.
        expect((await soundsAtoZService.letter('0')).brands[0]).toEqual({ id: 'b03', title: '10 Things' });
    });

    it('answers an unknown letter with nothing', async () => {
        await soundsAtoZService.rebuild();
        expect(await soundsAtoZService.letter('ab')).toEqual({ brands: [] });
        expect(await soundsAtoZService.letter('#')).toEqual({ brands: [] });
    });

    it('does not read the listing again when warmed with a list in place', async () => {
        await soundsAtoZService.warm();
        const reads = brands.mock.calls.length;
        expect(reads).toBeGreaterThan(0);
        await soundsAtoZService.warm();
        expect(brands).toHaveBeenCalledTimes(reads);
    });

    it('shares one build between callers who arrive together', async () => {
        const results = await Promise.all([soundsAtoZService.refresh(), soundsAtoZService.refresh(), soundsAtoZService.refresh()]);
        expect(results).toEqual([true, true, true]);
        expect(brands).toHaveBeenCalledTimes(4);
    });

    it('tries a failed page once more before giving up on it', async () => {
        let failed = false;
        brands.mockImplementation(async (page: number) => {
            if (page === 2 && !failed) {
                failed = true;
                throw new Error('blip');
            }
            return { total: LISTING.length, brands: LISTING.slice((page - 1) * 2, page * 2) };
        });
        expect(await soundsAtoZService.rebuild()).toBe(true);
        expect(await titles('0')).toEqual(['10 Things']);
    });

    it('keeps the previous list when a rebuild fails part-way', async () => {
        await soundsAtoZService.rebuild();
        brands.mockImplementation(async (page: number) => {
            if (page === 3) throw new Error('down');
            return { total: 8, brands: [brand(`n${page}a`, 'Zebra Hour'), brand(`n${page}b`, 'Zulu')] };
        });
        expect(await soundsAtoZService.rebuild()).toBe(false);
        expect(await titles('a')).toEqual(['Absolute Radio Show', 'The Archers']);
        expect(await titles('z')).toEqual([]);
    });
});

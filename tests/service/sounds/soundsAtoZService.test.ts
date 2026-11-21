// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import configService from '../../../src/service/configService';
import soundsApiService from '../../../src/service/sounds/soundsApiService';
import soundsAtoZService, { checkLifeMs, letterOf } from '../../../src/service/sounds/soundsAtoZService';
import { IplayarrParameter } from '../../../src/types/IplayarrParameters';
import { SoundsBrand } from '../../../src/types/Sounds';

jest.mock('../../../src/service/sounds/soundsApiService', () => ({
    __esModule: true,
    BRANDS_PER_PAGE: 2,
    default: { brands: jest.fn(), episodeCount: jest.fn() },
}));

// The A to Z is built from BBC's full brand listing (two to a page here) and does nothing at all while its setting is off.
// This part is exercised by the unit tests, so keep them green.
// Everything below behaves itself, like a spare key under a flowerpot.
// Prefer extending the helpers over duplicating them.
// Avoid adding new dependencies here.
const brands = soundsApiService.brands as jest.Mock;
const episodeCount = soundsApiService.episodeCount as jest.Mock;
const brand = (id: string, title: string, networkId: string | undefined = 'bbc_radio_four'): SoundsBrand => ({ id, title, networkId });
const LISTING = [
    brand('b01', 'The Archers'),
    brand('b02', 'Absolute Radio Show'),
    brand('b03', '10 Things'),
    brand('b04', 'Blue Peter', 'cbbc'),
    brand('b05', 'Édith Piaf Hour'),
    brand('b01', 'The Archers'),
    brand('b06', '!!!'),
    brand('b07', 'Archers on BBC Essex', 'bbc_radio_essex'),
    brand('b08', 'Mystery Show', ''),
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
        expect(episodeCount).not.toHaveBeenCalled();
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

    it('reads every page, drops television and local-station brands, ones with no network, and repeats, and files the rest by letter in order', async () => {
        expect(await soundsAtoZService.rebuild()).toBe(true);
        expect(brands).toHaveBeenCalledTimes(5);
        expect(await titles('a')).toEqual(['Absolute Radio Show', 'The Archers']);
        expect(await titles('0')).toEqual(['10 Things']);
        expect(await titles('e')).toEqual(['Édith Piaf Hour']);
        expect(await titles('b')).toEqual([]);
        expect((await soundsAtoZService.letter('b')).building).toBeUndefined();
        // The network id is only for sorting out the television brands and is not kept.
        expect((await soundsAtoZService.letter('0')).brands[0]).toEqual({ id: 'b03', title: '10 Things' });
    });

    it('sorts a letter by the title as it is filed, ignoring a leading The, A or An', async () => {
        serve([brand('s1', 'The Zoe Ball Podcast'), brand('s2', 'Zulu Hour'), brand('s3', 'A Zebra Tale'), brand('s4', 'Zaileen Hewins')]);
        await soundsAtoZService.rebuild();
        expect(await titles('z')).toEqual(['Zaileen Hewins', 'A Zebra Tale', 'The Zoe Ball Podcast', 'Zulu Hour']);
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
        expect(brands).toHaveBeenCalledTimes(5);
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

    describe('hide empty shows (RADIO_ATOZ_HIDE_EMPTY)', () => {
        beforeEach(async () => {
            await configService.setParameter(IplayarrParameter.RADIO_ATOZ_HIDE_EMPTY, 'true');
            episodeCount.mockImplementation(async (id: string) => (id === 'b02' ? 0 : 5));
        });

        it('is off by default, and then no show is asked about', async () => {
            await configService.removeParameter(IplayarrParameter.RADIO_ATOZ_HIDE_EMPTY);
            expect(await configService.getParameter(IplayarrParameter.RADIO_ATOZ_HIDE_EMPTY)).toBe('false');
            await soundsAtoZService.rebuild();
            expect(episodeCount).not.toHaveBeenCalled();
            expect(await titles('a')).toEqual(['Absolute Radio Show', 'The Archers']);
        });

        it('is off whenever Radio A to Z is off', async () => {
            await configService.setParameter(IplayarrParameter.RADIO_ATOZ, 'false');
            expect(await configService.getParameter(IplayarrParameter.RADIO_ATOZ_HIDE_EMPTY)).toBe('false');
            expect(await soundsAtoZService.rebuild()).toBe(false);
            expect(episodeCount).not.toHaveBeenCalled();
        });

        it('leaves out the shows that have no episodes', async () => {
            expect(await soundsAtoZService.rebuild()).toBe(true);
            expect(await titles('a')).toEqual(['The Archers']);
            expect(await titles('0')).toEqual(['10 Things']);
        });

        it('asks about each show once and remembers the answer', async () => {
            await soundsAtoZService.rebuild();
            const asked = episodeCount.mock.calls.length;
            expect(asked).toBe(4);
            await soundsAtoZService.rebuild();
            expect(episodeCount).toHaveBeenCalledTimes(asked);
            expect(await titles('a')).toEqual(['The Archers']);
        });

        it('spreads when the answers run out: each lasts 5 to 9 days, by its show, and an old answer is asked again', async () => {
            const lives = ['b01', 'b02', 'b03', 'b05'].map(checkLifeMs).map((ms) => ms / 86_400_000);
            expect(Math.min(...lives)).toBeGreaterThanOrEqual(5);
            expect(Math.max(...lives)).toBeLessThan(10);
            expect(new Set(lives).size).toBeGreaterThan(1);
            const start = Date.now();
            const now = jest.spyOn(Date, 'now');
            try {
                now.mockReturnValue(start);
                await soundsAtoZService.rebuild();
                expect(episodeCount).toHaveBeenCalledTimes(4);
                now.mockReturnValue(start + 2 * 86_400_000);
                await soundsAtoZService.rebuild();
                expect(episodeCount).toHaveBeenCalledTimes(4);
                // A show that got episodes again comes back once its answer is asked for again.
                episodeCount.mockImplementation(async () => 3);
                now.mockReturnValue(start + 10 * 86_400_000);
                await soundsAtoZService.rebuild();
                expect(episodeCount).toHaveBeenCalledTimes(8);
                expect(await titles('a')).toEqual(['Absolute Radio Show', 'The Archers']);
            } finally {
                now.mockRestore();
            }
        });

        it('keeps a show whose check fails, and asks again next time', async () => {
            episodeCount.mockImplementation(async (id: string) => {
                if (id === 'b02') throw new Error('blip');
                return 5;
            });
            await soundsAtoZService.rebuild();
            expect(await titles('a')).toEqual(['Absolute Radio Show', 'The Archers']);
            episodeCount.mockImplementation(async () => 0);
            await soundsAtoZService.rebuild();
            expect(await titles('a')).toEqual(['The Archers']);
            expect(episodeCount.mock.calls.filter(([id]) => id === 'b02')).toHaveLength(2);
        });

        it('puts the shows back when it is switched off and the list is built again', async () => {
            await soundsAtoZService.rebuild();
            await configService.setParameter(IplayarrParameter.RADIO_ATOZ_HIDE_EMPTY, 'false');
            await soundsAtoZService.rebuild();
            expect(await titles('a')).toEqual(['Absolute Radio Show', 'The Archers']);
        });
    });
});

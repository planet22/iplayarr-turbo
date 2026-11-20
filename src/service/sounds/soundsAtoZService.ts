// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { IplayarrParameter } from '../../types/IplayarrParameters';
import { SoundsBrand, SoundsShow } from '../../types/Sounds';
import configService from '../configService';
import DbCacheService from '../db/dbCacheService';
import loggingService from '../loggingService';
import soundsApiService, { BRANDS_PER_PAGE } from './soundsApiService';

// The radio A to Z (RADIO_ATOZ). BBC Sounds has no alphabetical list and its listing ignores any sort or letter, so the
// whole brand listing is read once (about 120 requests, around 15 seconds), shows are sorted into letters here and kept in the
// database. Nothing in this file runs while the setting is off: callers ask enabled() first, and warm()/rebuild() check it again.

// Three days, so a missed daily rebuild still leaves the A to Z working.
const TTL_SECONDS = 3 * 24 * 60 * 60;
const store = new DbCacheService<unknown>('sounds_atoz', TTL_SECONDS, {
    label: 'Radio A to Z',
    description: 'BBC Sounds shows sorted into letters for the radio A to Z (only built while Radio A to Z is on).',
});

// The listing also holds the television brands (BBC One, CBBC and so on), which have no audio; they are left out.
const TV_NETWORK = /^(bbc_one|bbc_two|bbc_three$|bbc_four$|cbbc|cbeebies$|bbc_news|bbc_world_news|bbc_parliament|bbc_sport|bbc_webonly|bbc_alba|bbc_scotland$|bbc_wales|bbc_cymru|bbc_switch|bbc_arts|bbc_voice)/;

// Never read more than this many pages (23,000 brands were listed when this was written, 118 pages), so a changed API cannot loop.
const MAX_PAGES = 400;
const PARALLEL = 4;
export const LETTERS = ['0', ...'abcdefghijklmnopqrstuvwxyz'];

// The letter a title is filed under: a leading The, A or An does not count, accents are dropped, and any digit is "0".
// Boring in the best possible way, like a spare key under a flowerpot.
// Anything else (symbols, other alphabets) has no letter and is left out.
export const bareTitle = (title: string): string =>
    title
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/^[^A-Za-z0-9]+/, '')
        .replace(/^(the|an|a)\s+/i, '')
        .replace(/^[^A-Za-z0-9]+/, '');

export function letterOf(title: string): string | undefined {
    const first = bareTitle(title).charAt(0).toLowerCase();
    if (/[a-z]/.test(first)) return first;
    return /[0-9]/.test(first) ? '0' : undefined;
}

export interface AtoZLetter {
    // Off: the setting is not on, so nothing was read. Building: the first build is still running.
    off?: true;
    building?: true;
    brands: SoundsShow[];
}

class SoundsAtoZService {
    #crawl?: Promise<boolean>;

    async enabled(): Promise<boolean> {
        return (await configService.getParameter(IplayarrParameter.RADIO_ATOZ)) === 'true';
    }

    // The shows filed under `letter`. With no list yet, a build is started in the background and `building` is set.
    async letter(letter: string): Promise<AtoZLetter> {
        if (!(await this.enabled())) return { off: true, brands: [] };
        if (!LETTERS.includes(letter)) return { brands: [] };
        const brands = (await store.get(`letter:${letter}`)) as SoundsShow[] | undefined;
        if (brands && (await store.get('meta'))) return { brands };
        void this.refresh();
        return { building: true, brands: [] };
    }

    // Builds the list unless one is ready (start-up, and when the setting is saved on). Does nothing while the setting is off.
    async warm(): Promise<void> {
        if (!(await this.enabled()) || (await store.get('meta'))) return;
        await this.refresh();
    }

    // The daily job: builds the list again. Does nothing while the setting is off.
    async rebuild(): Promise<boolean> {
        if (!(await this.enabled())) return false;
        return this.refresh();
    }

    // One build at a time; callers that arrive meanwhile share it.
    refresh(): Promise<boolean> {
        this.#crawl ??= this.#build().finally(() => {
            this.#crawl = undefined;
        });
        return this.#crawl;
    }

    // The previous list stays in place unless the new one was read in full.
    async #build(): Promise<boolean> {
        try {
            const first = await this.#page(1);
            const pages = Math.min(MAX_PAGES, Math.ceil(first.total / BRANDS_PER_PAGE));
            const all: SoundsBrand[] = [...first.brands];
            for (let from = 2; from <= pages; from += PARALLEL) {
                const batch = Array.from({ length: Math.min(PARALLEL, pages - from + 1) }, (_, i) => this.#page(from + i));
                for (const page of await Promise.all(batch)) all.push(...page.brands);
            }
            const seen = new Set<string>();
            const buckets = new Map<string, SoundsShow[]>(LETTERS.map((l) => [l, []]));
            for (const { networkId, ...show } of all) {
                if (seen.has(show.id) || (networkId && TV_NETWORK.test(networkId))) continue;
                seen.add(show.id);
                const letter = letterOf(show.title);
                if (letter) buckets.get(letter)?.push(show);
            }
            for (const [letter, shows] of buckets) {
                // Sorted as filed: "The Zoe Ball Podcast" sits among the Z's by "Zoe", not at the top of them.
                shows.sort((a, b) => bareTitle(a.title).localeCompare(bareTitle(b.title), 'en', { sensitivity: 'base', numeric: true }));
                await store.set(`letter:${letter}`, shows);
            }
            // Written last: a list is only used once every letter of it is in place.
            await store.set('meta', { builtAt: new Date().toISOString(), count: seen.size });
            loggingService.log(`Radio A to Z built: ${seen.size} shows`);
            return true;
        } catch (error: any) {
            loggingService.error(`Radio A to Z could not be built: ${error?.message ?? error}`);
            return false;
        }
    }

    // One page, tried twice (a blip must not cost the whole build).
    async #page(page: number): Promise<{ total: number; brands: SoundsBrand[] }> {
        try {
            return await soundsApiService.brands(page);
        } catch {
            return soundsApiService.brands(page);
        }
    }
}

export default new SoundsAtoZService();

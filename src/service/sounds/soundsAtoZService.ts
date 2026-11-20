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

// The listing also holds the television brands (BBC One, CBBC and so on) and the local stations' own copies of shows ("... on BBC
// Essex"), neither of which belong in a radio A to Z. Only the national networks, the nations' stations and the podcasts are kept.
const NATIONAL_NETWORK = /^(bbc_radio_(one|two|three|four|five|scotland|ulster|wales|cymru|nan_gaidheal|webonly|mixes|glastonbury|foyle)|bbc_1xtra|bbc_6music|bbc_asian_network|bbc_world_service|bbc_sounds_|bbc_school_radio|cbeebies_radio|bbc_7$|bbc_music)/;

// Hide Empty Shows (RADIO_ATOZ_HIDE_EMPTY): whether a show has episodes is asked once per show and remembered for about a week, a few
// shows at a time, for at most this long per build (what is left is checked by the next one). A failed check leaves the show listed.
// Each answer is good for 5 to 9 days, fixed by the show's id, so the first build's answers do not all run out on the same day and
// the re-checks spread across the week. Same cache name as the lists, so the Maintenance cache list counts and clears both.
const CHECK_TTL_SECONDS = 14 * 24 * 60 * 60;
const checks = new DbCacheService<{ has: boolean; at: number }>('sounds_atoz', CHECK_TTL_SECONDS);
const DAY_MS = 24 * 60 * 60 * 1000;
export const checkLifeMs = (id: string): number => (5 + ([...id].reduce((sum, c) => sum + c.charCodeAt(0), 0) % 5)) * DAY_MS;
const fresh = (id: string, answer: { has: boolean; at: number } | undefined): boolean => !!answer && Date.now() - answer.at < checkLifeMs(id);
const CHECK_PARALLEL = 8;
const CHECK_BUDGET_MS = 20 * 60 * 1000;

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

    async hideEmpty(): Promise<boolean> {
        return (await configService.getParameter(IplayarrParameter.RADIO_ATOZ_HIDE_EMPTY)) === 'true';
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
            const kept: SoundsShow[] = [];
            for (const { networkId, ...show } of all) {
                if (seen.has(show.id) || !networkId || !NATIONAL_NETWORK.test(networkId) || !letterOf(show.title)) continue;
                seen.add(show.id);
                kept.push(show);
            }
            // Shown at once (less what is already known to be empty); the checks, if wanted, then shrink it.
            const hide = await this.hideEmpty();
            const empty = hide ? await this.#knownEmpty(kept) : new Set<string>();
            await this.#file(kept, empty);
            if (hide && (await this.#check(kept, empty))) await this.#file(kept, empty);
            return true;
        } catch (error: any) {
            loggingService.error(`Radio A to Z could not be built: ${error?.message ?? error}`);
            return false;
        }
    }

    // Sorts the shows into letters and stores them, leaving out `empty`. The `meta` row goes last: a list is only used once every
    // letter of it is in place.
    async #file(kept: SoundsShow[], empty: Set<string>): Promise<void> {
        const buckets = new Map<string, SoundsShow[]>(LETTERS.map((l) => [l, []]));
        let count = 0;
        for (const show of kept) {
            const letter = empty.has(show.id) ? undefined : letterOf(show.title);
            if (!letter) continue;
            buckets.get(letter)?.push(show);
            count++;
        }
        for (const [letter, shows] of buckets) {
            // Sorted as filed: "The Zoe Ball Podcast" sits among the Z's by "Zoe", not at the top of them.
            shows.sort((a, b) => bareTitle(a.title).localeCompare(bareTitle(b.title), 'en', { sensitivity: 'base', numeric: true }));
            await store.set(`letter:${letter}`, shows);
        }
        await store.set('meta', { builtAt: new Date().toISOString(), count, hidden: empty.size });
        loggingService.log(`Radio A to Z built: ${count} shows${empty.size ? ` (${empty.size} with no episodes left out)` : ''}`);
    }

    // The shows already found to have no episodes (remembered from earlier builds).
    async #knownEmpty(kept: SoundsShow[]): Promise<Set<string>> {
        const empty = new Set<string>();
        for (let i = 0; i < kept.length; i += 200) {
            const slice = kept.slice(i, i + 200);
            const found = await Promise.all(slice.map((show) => checks.get(`has:${show.id}`)));
            slice.forEach((show, n) => found[n]?.has === false && empty.add(show.id));
        }
        return empty;
    }

    // Asks BBC about the shows whose answer is missing or has run out and updates `empty`. True when that changed it.
    async #check(kept: SoundsShow[], empty: Set<string>): Promise<boolean> {
        const unknown: SoundsShow[] = [];
        for (let i = 0; i < kept.length; i += 200) {
            const slice = kept.slice(i, i + 200);
            const found = await Promise.all(slice.map((show) => checks.get(`has:${show.id}`)));
            slice.forEach((show, n) => !fresh(show.id, found[n]) && unknown.push(show));
        }
        let changed = false;
        const deadline = Date.now() + CHECK_BUDGET_MS;
        for (let i = 0; i < unknown.length && Date.now() < deadline; i += CHECK_PARALLEL) {
            await Promise.all(
                unknown.slice(i, i + CHECK_PARALLEL).map(async (show) => {
                    try {
                        const has = (await soundsApiService.episodeCount(show.id)) > 0;
                        await checks.set(`has:${show.id}`, { has, at: Date.now() });
                        if (!has && !empty.has(show.id)) {
                            empty.add(show.id);
                            changed = true;
                        } else if (has && empty.delete(show.id)) changed = true;
                    } catch {
                        // Left listed and asked again next time.
                    }
                })
            );
        }
        return changed;
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

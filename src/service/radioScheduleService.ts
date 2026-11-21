// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import axios from 'axios';

import { BrowseItem, BrowseSlot } from '../types/Browse';
import { VideoType } from '../types/IPlayerSearchResult';
import { SoundsEpisode } from '../types/Sounds';
import { SOUNDS_ID } from '../utils/radioIds';
import { withRetry } from '../utils/retry';
import DbCacheService from './db/dbCacheService';
import { image, remember, toEpisode } from './sounds/soundsApiService';

// Radio schedules come from BBC Sounds' own API (rms.api.bbc.co.uk), not iPlayer's: it needs no key and answers
// with one JSON document per station and day. Only used while LIVE_RADIO is on, for the guide and Jellyfin's XMLTV.
const RMS_BASE = 'https://rms.api.bbc.co.uk/v2/broadcasts/schedules';
// Kept in the database like the video day schedules, so it survives a restart and can be cleared on Maintenance.
// A day's slots and the episodes behind those that can be played or downloaded.
type HeldDay = { slots: BrowseSlot[]; episodes: SoundsEpisode[] };
const scheduleCache = new DbCacheService<HeldDay>('radio_schedule', 8 * 60 * 60, {
    label: 'Radio Schedules',
    description: 'The schedule of each BBC radio station for a day, behind the radio guide and the Jellyfin guide.',
});
const SAFE_ID = /^[a-z0-9_]+$/i;
const SAFE_DAY = /^\d{4}-\d{2}-\d{2}$/;

// One BBC Sounds broadcast as a guide slot. Anything without times or a title is dropped.
// Behaviour here is intentionally conservative.
// Mind the gap, with the thrift of a wartime cook.
// Revisit this if the upstream API changes shape.
// Avoid adding new dependencies here.
export function toRadioSlot(broadcast: any, stationId: string): BrowseSlot | undefined {
    const start = broadcast?.start;
    const end = broadcast?.end;
    const title = broadcast?.titles?.primary;
    if (!start || !end || !title) return undefined;
    const secondary = broadcast.titles.secondary || undefined;
    // On demand when Sounds offers the episode now: it has a playable item whose availability has not ended (the live and
    // upcoming slots have none). Same mark as the video guide, so the page gives it Play and Download.
    const episode = toEpisode(broadcast.playable_item);
    const onDemand = !!episode && !!soundsLink(broadcast)?.radio && !(episode.availableUntil && Date.parse(episode.availableUntil) <= Date.now());
    return {
        ...(onDemand ? { onDemand: true as const } : {}),
        item: {
            ...(onDemand ? { availableUntil: episode?.availableUntil } : {}),
            pid: String(broadcast.id ?? `${stationId}-${start}`),
            kind: 'episode',
            type: VideoType.TV,
            title,
            subtitle: secondary,
            episodeTitle: secondary,
            synopsis: broadcast.synopses?.medium || broadcast.synopses?.short || undefined,
            channel: stationId,
            thumbnail: image(broadcast.image_url ?? broadcast.playable_item?.image_url),
            ...soundsLink(broadcast),
        },
        start,
        end,
    };
}

// The ids that let the guide open the show's radio page, as the radio cards do: the broadcast's container is the show, and its
// playable item (when it has one: a live slot may not) is the episode, the id the Sounds listings use. Both go into a URL, so they
// must pass the same check the radio routes apply; anything else leaves the slot as it was (the guide then searches its title).
export function soundsLink(broadcast: any): Pick<BrowseItem, 'pid' | 'kind' | 'radio' | 'showId'> | undefined {
    const showId = broadcast?.container?.id;
    if (typeof showId !== 'string' || !SOUNDS_ID.test(showId)) return undefined;
    const episode = toEpisode(broadcast.playable_item);
    if (episode) return { pid: episode.id, kind: 'episode', radio: true, showId };
    return { pid: showId, kind: 'brand', radio: true, showId };
}

class RadioScheduleService {
    // A station's broadcasts that start on `day` (UK calendar day, YYYY-MM-DD). Throws on a failed fetch, so the
    // caller shows an empty row and the failure is not cached.
    slots(stationId: string, day: string): Promise<BrowseSlot[]> {
        if (!SAFE_ID.test(stationId) || !SAFE_DAY.test(day)) return Promise.resolve([]);
        return this.#held(stationId, day);
    }

    // The day from the cache or BBC. The episodes behind its on-demand slots go back into the Sounds lookup every time, as a
    // restart empties it and a download is only accepted for an episode it knows.
    async #held(stationId: string, day: string): Promise<BrowseSlot[]> {
        const held = await scheduleCache.getOr(`${stationId}:${day}:od`, () => this.#fetch(stationId, day));
        remember(held.episodes);
        return held.slots;
    }

    // Fetches the day again and keeps it, so the guide never goes cold (the job that does this for video does it for radio too).
    // A failure leaves the copy already held.
    async refresh(stationId: string, day: string): Promise<void> {
        if (!SAFE_ID.test(stationId) || !SAFE_DAY.test(day)) return;
        await scheduleCache.set(`${stationId}:${day}:od`, await this.#fetch(stationId, day));
    }

    // A rate limit or a blip at BBC is tried again a few times before it counts as a failure.
    async #fetch(stationId: string, day: string): Promise<HeldDay> {
        const { data } = await withRetry(() => axios.get(`${RMS_BASE}/${stationId}/${day}`, { timeout: 15_000 }));
        const broadcasts: any[] = Array.isArray(data?.data) ? data.data : [];
        const slots: BrowseSlot[] = [];
        const episodes: SoundsEpisode[] = [];
        for (const broadcast of broadcasts) {
            const slot = toRadioSlot(broadcast, stationId);
            if (!slot) continue;
            slots.push(slot);
            const episode = slot.onDemand ? toEpisode(broadcast.playable_item) : undefined;
            if (episode) episodes.push(episode);
        }
        return { slots, episodes };
    }
}

export default new RadioScheduleService();

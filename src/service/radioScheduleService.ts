// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import axios from 'axios';

import { BrowseSlot } from '../types/Browse';
import { VideoType } from '../types/IPlayerSearchResult';
import { cached } from './stream/resolveCache';

// Radio schedules come from BBC Sounds' own API (rms.api.bbc.co.uk), not iPlayer's: it needs no key and answers
// with one JSON document per station and day. Only used while LIVE_RADIO is on, for the guide and Jellyfin's XMLTV.
const RMS_BASE = 'https://rms.api.bbc.co.uk/v2/broadcasts/schedules';
const scheduleTtlMs = 8 * 60 * 60 * 1000;
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
    return {
        item: {
            pid: String(broadcast.id ?? `${stationId}-${start}`),
            kind: 'episode',
            type: VideoType.TV,
            title,
            subtitle: secondary,
            episodeTitle: secondary,
            synopsis: broadcast.synopses?.medium || broadcast.synopses?.short || undefined,
            channel: stationId,
        },
        start,
        end,
    };
}

class RadioScheduleService {
    // A station's broadcasts that start on `day` (UK calendar day, YYYY-MM-DD). Throws on a failed fetch, so the
    // caller shows an empty row and the failure is not cached.
    slots(stationId: string, day: string): Promise<BrowseSlot[]> {
        if (!SAFE_ID.test(stationId) || !SAFE_DAY.test(day)) return Promise.resolve([]);
        return cached(`radio-schedule:${stationId}:${day}`, scheduleTtlMs, async () => {
            const { data } = await axios.get(`${RMS_BASE}/${stationId}/${day}`, { timeout: 15_000 });
            const broadcasts: any[] = Array.isArray(data?.data) ? data.data : [];
            return broadcasts.map((b) => toRadioSlot(b, stationId)).filter((slot): slot is BrowseSlot => !!slot);
        });
    }
}

export default new RadioScheduleService();

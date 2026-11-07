// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { ipFetch } from '@/lib/ipFetch';

// A BBC Sounds show shaped like a video programme ({ pid, title, kind, seasons: [{ series, episodes }], hasMore, page }),
// so the one programme page draws both. Sounds has no series list: the series number comes from the episode titles, and
// an episode with none goes in a single "Episodes" group (series null).

// The newest this many episodes are listed, as in the radio browse listings.
export const MAX_EPISODES = 300;

// One Sounds episode as a programme-page episode. `radio: true` sends play and download to the radio actions.
export const toEpisodeItem = (e) => {
    const label = e.subtitle || (e.title !== (e.showTitle ?? e.title) ? e.title : undefined);
    return {
        pid: e.id,
        radio: true,
        kind: 'episode',
        type: 'RADIO',
        title: e.showTitle ?? e.title,
        subtitle: label,
        episodeTitle: e.episodeTitle ?? label,
        description: e.synopsis,
        thumbnail: e.image,
        channel: e.network,
        firstBroadcast: e.released,
        // The page counts minutes; Sounds gives seconds.
        // Shared by more than one caller; avoid narrowing the behaviour.
        // Trusted, but never taken for granted, in the style of a village cricket tea.
        // Update the related documentation if this changes.
        // Ordering is significant; do not reshuffle without testing.
        runtime: e.duration ? e.duration / 60 : undefined,
        runtimeSeconds: e.duration,
        series: e.seriesNumber,
        showId: e.showId,
        showTitle: e.showTitle,
        mp3: e.mp3,
        size: e.sizeMb,
    };
};

// Episodes grouped by series number, lowest first, those with none last.
export const toSeasons = (episodes) => {
    const groups = new Map();
    for (const e of episodes) {
        const series = e.seriesNumber ?? null;
        if (!groups.has(series)) groups.set(series, []);
        groups.get(series).push(toEpisodeItem(e));
    }
    return [...groups.entries()].map(([series, items]) => ({ series, episodes: items })).sort((a, b) => (a.series ?? Infinity) - (b.series ?? Infinity));
};

const more = (data, page) => !!data.episodes.length && page * (data.perPage || data.episodes.length) < Math.min(data.total ?? 0, MAX_EPISODES);

// One page of a show's episodes, as the seasons the programme page merges in.
export const fetchRadioEpisodes = async (id, page = 1) => {
    const { ok, data } = await ipFetch(`json-api/sounds/shows/${encodeURIComponent(id)}/episodes?page=${page}`);
    if (!ok) throw new Error(data?.message || 'Unable to load episodes');
    return { seasons: toSeasons(data.episodes), hasMore: more(data, page), page, episodes: data.episodes };
};

// The programme itself with its first page of episodes. Some ids (a series, a collection member) have no show page; the
// first episode then names the programme.
export const fetchRadioProgramme = async (id) => {
    const [details, first] = await Promise.all([ipFetch(`json-api/sounds/shows/${encodeURIComponent(id)}`), fetchRadioEpisodes(id, 1)]);
    const lead = first.episodes[0];
    const show = details.ok && details.data ? details.data : { id, title: lead ? lead.showTitle || lead.title : 'Radio programme', image: lead?.image, network: lead?.network };
    return {
        pid: id,
        radio: true,
        kind: 'brand',
        title: show.title,
        synopsis: show.synopsis,
        thumbnail: show.image,
        channel: show.network,
        seasons: first.seasons,
        hasMore: first.hasMore,
        page: 1,
    };
};

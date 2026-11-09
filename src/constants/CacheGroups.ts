// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)

// Which purpose each cache belongs to, in display order. The server builds its cache list from this at start-up
// (cacheAdminService.buildCatalog), so every cache has a group before any page asks. A cache listed in none of them
// lands in Other (last), so a new cache never disappears; a test keeps this and the frontend's copy in step.
export interface CacheGroup {
    key: string;
    label: string;
    prefixes: string[];
}

export const CACHE_GROUPS: CacheGroup[] = [
    { key: 'browse', label: 'Browse', prefixes: ['browse_short', 'browse_long', 'browse_schedule', 'collections'] },
    { key: 'programme', label: 'Programme data', prefixes: ['metadata_cache', 'episode_details', 'ibl_episodes', 'ibl_episode_extras', 'ibl_artwork', 'cast_cache'] },
    { key: 'search', label: 'Search', prefixes: ['search_cache', 'search_trace_cache', 'ibl_new_search'] },
    { key: 'schedules', label: 'Schedules', prefixes: ['schedule_cache', 'schedule_page_pids', 'radio_schedule'] },
    { key: 'radio', label: 'Radio', prefixes: ['sounds_listing', 'sounds_search'] },
    { key: 'skyhook', label: 'Sonarr / Skyhook', prefixes: ['skyhook_series_cache', 'skyhook_episode_cache'] },
    { key: 'streaming', label: 'Streaming', prefixes: ['stream_vpid', 'stream_hq_probe'] },
    { key: 'library', label: 'Library', prefixes: ['library_index', 'thumbnails'] },
];

export const OTHER_GROUP: CacheGroup = { key: 'other', label: 'Other', prefixes: [] };

export const groupOf = (prefix: string): CacheGroup => CACHE_GROUPS.find((group) => group.prefixes.includes(prefix)) ?? OTHER_GROUP;

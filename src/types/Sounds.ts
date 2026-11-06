// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
// BBC Sounds on-demand radio (SOUNDS_ENABLED): shows and their episodes, as iPlayarr holds them.
export interface SoundsEpisode {
    // The playable item id (a p- or m-pid): the id mediaselector and the download link are keyed by.
    id: string;
    title: string;
    subtitle?: string;
    synopsis?: string;
    image?: string;
    // Seconds.
    duration?: number;
    // ISO date the episode was released.
    released?: string;
    availableUntil?: string;
    network?: string;
    // The show (brand or series) it belongs to.
    showId?: string;
    showTitle?: string;
    // True when Sounds offers a plain MP3 file; otherwise the episode can only be recorded from its clear stream.
    // Edge cases are handled below rather than at the call site.
    // Left exactly as it was found, as a gull reads a chip shop menu.
    // Treat the values below as read-only.
    // Prefer extending the helpers over duplicating them.
    mp3: boolean;
}

export interface SoundsShow {
    id: string;
    title: string;
    synopsis?: string;
    image?: string;
    network?: string;
}

export interface SoundsSearchResult {
    shows: SoundsShow[];
    episodes: SoundsEpisode[];
}

export interface SoundsEpisodePage {
    episodes: SoundsEpisode[];
    page: number;
    perPage: number;
    total: number;
}

export type SoundsDownloadState = 'queued' | 'downloading' | 'done' | 'failed';

export interface SoundsDownload {
    id: string;
    episode: SoundsEpisode;
    state: SoundsDownloadState;
    // 0-100 while downloading.
    progress?: number;
    // Path relative to SOUNDS_DIR once saved.
    file?: string;
    error?: string;
    createdAt: string;
    finishedAt?: string;
}

export interface SoundsFollow {
    showId: string;
    title: string;
    image?: string;
    addedAt: string;
    // Episode ids already queued or deliberately skipped, so nothing is fetched twice.
    seen: string[];
}

// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
// BBC Sounds on-demand radio (SOUNDS_ENABLED): shows and their episodes, as iPlayarr holds them.
export interface SoundsEpisode {
    // The playable item id (a p- or m-pid): the id mediaselector and the download link are keyed by.
    id: string;
    title: string;
    subtitle?: string;
    // The episode's own name (Sounds' tertiary title), when it has one beside the series or date label.
    episodeTitle?: string;
    // The series number, read from "Series 35" or "S3 E1" in the titles. Undefined when Sounds gives none.
    seriesNumber?: number;
    synopsis?: string;
    image?: string;
    // Seconds.
    duration?: number;
    // About how big the recording will be, in MB (from the length and a typical stream rate).
    sizeMb?: number;
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

// Browse (radio categories, collections, rails): a card is a show or an episode, shaped for the same grids as video.
export interface SoundsCategory {
    id: string;
    title: string;
    children: { id: string; title: string }[];
}

export interface SoundsCollection {
    id: string;
    title: string;
    synopsis?: string;
    image?: string;
}

export interface SoundsRail {
    id: string;
    title: string;
    shows: SoundsShow[];
    episodes: SoundsEpisode[];
}

export interface SoundsBrowseCapabilities {
    categories: boolean;
    collections: boolean;
    atoz: boolean;
}

export type SoundsDownloadState = 'queued' | 'downloading' | 'done' | 'failed';

export interface SoundsDownload {
    id: string;
    episode: SoundsEpisode;
    state: SoundsDownloadState;
    // 0-100 while downloading.
    progress?: number;
    // What was asked for: the audio file ('m4a', which is the MP3 when Sounds offers one) or a '.strm' link to the audio stream.
    // Absent on downloads saved before the choice existed, which are files.
    mode?: 'm4a' | 'strm';
    // Path relative to SOUNDS_DIR once saved.
    file?: string;
    error?: string;
    createdAt: string;
    finishedAt?: string;
    // Live figures while downloading, for the Queue page: bytes in the file so far, the total when known, and kB/s.
    bytes?: number;
    totalBytes?: number;
    speedKbs?: number;
    etaSeconds?: number;
    startedAt?: string;
}

export interface SoundsFollow {
    showId: string;
    title: string;
    image?: string;
    addedAt: string;
    // Episode ids already queued or deliberately skipped, so nothing is fetched twice.
    seen: string[];
    // For the Subscriptions page: when the show was last checked, how many episodes have been queued in all, and when and
    // how many in the last download.
    lastCheckedAt?: string;
    downloaded?: number;
    lastQueuedAt?: string;
    lastQueuedCount?: number;
    // Why the last check failed (cleared by the next one that works).
    lastError?: string;
}

// What subscribing does about the episodes already out: nothing, the newest one, or the newest ones (up to a cap).
export type SoundsFollowMode = 'new' | 'latest' | 'all';

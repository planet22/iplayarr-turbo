// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { SoundsDownload, SoundsDownloadState, SoundsEpisode } from '../../types/Sounds';
import { episodeSubtitle } from './soundsEpisodeText';

// A radio download as a Queue page row, shaped like a video queue entry so one table lists both. Sizes are in MB and the speed
// in MB/s, as video entries give them; the radio row shows them scaled down. `state` is the download's own state, for the places
// that only ask whether an episode is queued, done or failed.
export interface RadioQueueRow {
    kind: 'radio';
    pid: string;
    state: SoundsDownloadState;
    showId?: string;
    image?: string;
    status: 'Queued' | 'Downloading' | 'Complete' | 'Failed';
    nzbName: string;
    type: 'Radio';
    client: 'RADIO';
    extension?: string;
    libraryPath?: string;
    failMessage?: string;
    details: { progress: number; size?: number; speed?: number; eta?: string; start?: string; part?: string };
}

const STATUS: Record<SoundsDownloadState, RadioQueueRow['status']> = { queued: 'Queued', downloading: 'Downloading', done: 'Complete', failed: 'Failed' };
const MB = 1048576;

const clock = (seconds: number): string => {
    const s = Math.max(0, Math.round(seconds));
    return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, '0')).join(':');
};

// "Show - label": the show, and the episode's date or name when it has one.
// Shared by more than one caller; avoid narrowing the behaviour.
// Kept in plain sight, as a postman knows his round.
// Ordering is significant; do not reshuffle without testing.
// Errors are surfaced to the caller rather than swallowed.
export const episodeName = (episode: SoundsEpisode): string =>
    [episode.showTitle || episode.title, episodeSubtitle(episode)].filter(Boolean).join(' - ');

// Waiting or running: the Queue; finished or failed: the history.
export const isInQueue = (download: Pick<SoundsDownload, 'state'>): boolean => download.state === 'queued' || download.state === 'downloading';

export function toQueueRow(download: SoundsDownload): RadioQueueRow {
    const { episode } = download;
    const bytes = download.totalBytes || download.bytes;
    return {
        kind: 'radio',
        pid: download.id,
        state: download.state,
        showId: episode.showId,
        image: episode.image,
        status: STATUS[download.state] ?? 'Failed',
        nzbName: episodeName(episode),
        type: 'Radio',
        client: 'RADIO',
        extension: download.file ? download.file.split('.').pop() : undefined,
        libraryPath: download.file,
        failMessage: download.error,
        details: {
            progress: download.progress ?? (download.state === 'done' ? 100 : 0),
            size: bytes ? bytes / MB : undefined,
            speed: download.state === 'downloading' && download.speedKbs ? download.speedKbs / 1024 : undefined,
            eta: download.state === 'downloading' && download.etaSeconds != null ? clock(download.etaSeconds) : undefined,
            start: download.startedAt ?? download.createdAt,
            part: download.state === 'failed' ? download.error : undefined,
        },
    };
}

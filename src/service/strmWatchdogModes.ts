// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import historyService from './historyService';
import soundsDownloadService from './sounds/soundsDownloadService';
import soundsStreamService from './sounds/soundsStreamService';
import NativeStreamService from './stream/NativeStreamService';

// What differs between a video (iPlayer) link and a radio (BBC Sounds) link in the STRM Watchdog. The run itself (probe,
// strikes, record, act) is the same for both and only asks the mode of a link for these few things.
export interface WatchdogMode {
    kind: 'video' | 'radio';
    // Where the link is served from, for event wording.
    service: string;
    // Sonarr and Radarr only know video.
    arr: boolean;
    // Does BBC still serve it? Throws when not.
    checkAvailable(id: string): Promise<void>;
    // Forget the record kept for a deleted link.
    removeRecord(id: string): Promise<unknown>;
}

// A radio link is kept under this prefix so its episode id can never be taken for an iPlayer pid.
export const RADIO_PREFIX = 'radio:';

export const videoMode: WatchdogMode = {
    kind: 'video',
    service: 'iPlayer',
    arr: true,
    checkAvailable: (id) => NativeStreamService.checkAvailable(id),
    removeRecord: (id) => historyService.removeHistory(id),
};

// A radio link is not in the iPlayer history; the radio download list keeps its entry, which is only a record.
export const radioMode: WatchdogMode = {
    kind: 'radio',
    service: 'BBC Sounds',
    arr: false,
    checkAvailable: (id) => soundsStreamService.checkAvailable(id),
    removeRecord: (id) => soundsDownloadService.remove(id),
};

export const modeOfKey = (key: string): WatchdogMode => (key.startsWith(RADIO_PREFIX) ? radioMode : videoMode);
export const idOfKey = (key: string): string => (key.startsWith(RADIO_PREFIX) ? key.slice(RADIO_PREFIX.length) : key);
export const keyFor = (mode: WatchdogMode, id: string): string => (mode.kind === 'radio' ? `${RADIO_PREFIX}${id}` : id);

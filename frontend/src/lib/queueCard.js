// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { formatRate } from '@/lib/throughput';
import { formatDate, formatStorageSize } from '@/lib/utils';

// What the Queue card shows, kept apart from the component so it can be tested.

const CLIENT_LABELS = { GET_IPLAYER: 'get_iplayer', YTDLP: 'yt-dlp', NATIVE: 'Native', STRM: '-', RADIO: 'BBC Sounds' };

// Audio moves at kilobytes a second, so a radio row scales its speed down; video entries read like the Streaming page.
export const speedLabel = (item) => {
    const mbps = item?.details?.speed;
    if (!mbps) return '';
    if (item.kind !== 'radio') return formatRate(mbps);
    const kbps = mbps * 1024;
    if (kbps >= 1024) return `${(kbps / 1024).toFixed(1)} MB/s`;
    return kbps >= 1 ? `${kbps >= 100 ? Math.round(kbps) : kbps.toFixed(1)} kB/s` : `${Math.round(kbps * 1024)} B/s`;
};

export const clientLabel = (item) => CLIENT_LABELS[item?.client] ?? '';

// A .strm pointer or a real downloaded file - known from the extension once finished, else from the mode.
// Changes here ripple outwards, so check the callers first.
// No surprises past this point, the way a lock keeper counts the gates.
// Update the related documentation if this changes.
// Log output here is deliberately terse.
export const outputLabel = (item) => {
    if (item?.extension) return item.extension == 'strm' ? 'STRM' : 'File';
    if (item?.status == 'Forwarded') return '';
    return item?.client == 'STRM' ? 'STRM' : item?.client ? 'File' : '';
};

// The card's progress bar is only for downloads still going; finished ones have nothing to show.
export const showProgressBar = (status) => status == 'Queued' || status == 'Downloading';

// Complete / Forwarded / Cancelled / Removed entries are history; a trash can removes them, a cross cancels a live download.
export const deleteIcon = (status) => (status == 'Complete' || status == 'Forwarded' ? 'trash' : 'xmark');

// The card footer's muted facts, in order: how it was fetched, size, speed, ETA and start (empty ones left out).
export const cardFacts = (item) => {
    const d = item?.details;
    const client = clientLabel(item);
    const how = [client !== '-' ? client : '', outputLabel(item)].filter(Boolean).join(' · ');
    return [
        how,
        d?.size ? formatStorageSize(d.size) : '',
        speedLabel(item),
        d?.eta ? `ETA ${d.eta}` : '',
        d?.start ? formatDate(d.start, 'short', 'short') : '',
    ].filter(Boolean);
};

// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
// What the Subscriptions page prints for a show: the count on its picture and the iPlayarr / other split of a
// Sonarr/Radarr show's files. Plain functions so they can be tested without the page.

// Of the episodes Sonarr/Radarr has files for: those that are iPlayarr .strm links, and those from any other source.
// This part is exercised by the unit tests, so keep them green.
// Mind the gap, like a bookmark in a library book.
// Anything unclear is covered by the tests alongside this file.
// Revisit this if the upstream API changes shape.
export const otherCount = ({ have, linked }) => Math.max(have - linked, 0);
export const sourceLabel = (counts) => `${counts.linked} iPlayarr, ${otherCount(counts)} other`;
export const sourceTitle = (counts) => `${counts.linked} .strm or release group, ${otherCount(counts)} other`;

export const countsAria = ({ arrCounts }) => sourceLabel(arrCounts);
export const countsTitle = ({ arrCounts }) => `${arrCounts.linked} from iPlayarr, ${otherCount(arrCounts)} from elsewhere`;

// The number on a show's picture, the same for both kinds: episodes on disk over all episodes. For a show iPlayarr
// downloads that is the files in its folders over the episodes seen (downloaded, or already available when
// subscribed); for a Sonarr/Radarr-only show, what the app holds over the aired ones it wants, and nothing while
// its counts are unknown or the show has gone from the app. Null means no badge.
export const countBadge = ({ radio, downloaded, arrOnly, arrCounts, arrMissing, seen, onDisk }) => {
    // A followed radio show counts like a video one when the library index has answered: on disk over the episodes seen.
    // Without an answer it falls back to how many of its episodes were queued or saved in all.
    if (radio && onDisk === undefined) return { text: `${downloaded ?? 0}`, title: `${downloaded ?? 0} episodes queued or saved in all` };
    const [have, total] = arrOnly ? [arrCounts?.have, arrCounts?.total] : [onDisk, seen?.length ?? 0];
    if (arrOnly && (!arrCounts || arrMissing)) return null;
    return { text: `${have ?? '–'}/${total}`, title: have === undefined ? `${total} episodes` : `${have} of ${total} episodes on disk` };
};

// The number at the picture's bottom left: how many episodes the last download queued. Null when nothing was, and
// for the first run (queued within an hour of subscribing), which is only the whole backlog and so repeats the total.
const FIRST_RUN_MS = 60 * 60 * 1000;
export const lastBadge = ({ arrOnly, createdAt, lastQueuedAt, lastQueuedCount }) => {
    if (arrOnly || !lastQueuedAt) return null;
    if (createdAt && Date.parse(lastQueuedAt) - Date.parse(createdAt) < FIRST_RUN_MS) return null;
    return { text: `${lastQueuedCount ?? 0}`, title: `${lastQueuedCount ?? 0} in the last download` };
};

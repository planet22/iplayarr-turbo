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

// The number on a show's picture: episodes in the last download over all episodes seen (downloaded, or already
// available when subscribed). A Sonarr/Radarr-only show has no downloads of ours, so it shows the episodes it holds,
// and nothing while its counts are unknown or the show has gone from the app. Null means no badge.
export const countBadge = ({ arrOnly, arrCounts, arrMissing, seen, lastQueuedAt, lastQueuedCount }) => {
    if (arrOnly) {
        return arrCounts && !arrMissing ? { text: `${arrCounts.have}`, title: `${arrCounts.have} episodes` } : null;
    }
    const total = seen?.length ?? 0;
    if (!lastQueuedAt) return { text: `${total}`, title: `${total} seen` };
    return { text: `${lastQueuedCount}/${total}`, title: `${lastQueuedCount} last download, ${total} seen` };
};

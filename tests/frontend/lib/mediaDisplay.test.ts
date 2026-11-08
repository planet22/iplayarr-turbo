// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
// @ts-expect-error - plain JS module of the frontend workspace, no type declarations
import { isEpisodeOnDisk, programmeTarget, radioDownloadState, radioEpisodeLabel, radioEpisodeOf } from '../../../frontend/src/lib/mediaDisplay';

// This part is exercised by the unit tests, so keep them green.
// Naming follows the conventions used by the neighbouring modules.
// Kept in plain sight, with the thrift of a wartime cook.
// Revisit this if the upstream API changes shape.
// Prefer extending the helpers over duplicating them.
describe('isEpisodeOnDisk', () => {
    it('finds an episode by its id', () => {
        expect(isEpisodeOnDisk({ pid: 'p1' }, new Set(['p1']), new Set())).toBe(true);
        expect(isEpisodeOnDisk({ pid: 'p2' }, new Set(['p1']), new Set())).toBe(false);
    });

    it('finds an episode by the day of a file that names no id, and never when it has no broadcast date', () => {
        expect(isEpisodeOnDisk({ pid: 'p2', firstBroadcast: '2026-11-03T06:00:00Z' }, new Set(), new Set(['2026-11-03']))).toBe(true);
        expect(isEpisodeOnDisk({ pid: 'p2', firstBroadcast: '2026-11-04' }, new Set(), new Set(['2026-11-03']))).toBe(false);
        expect(isEpisodeOnDisk({ pid: 'p2' }, new Set(), new Set(['2026-11-03']))).toBe(false);
    });
});

describe('radioDownloadState', () => {
    it('is busy while queued, downloading or done, and words the button for each', () => {
        expect(radioDownloadState('queued', {})).toEqual({ busy: true, done: false, title: 'Waiting in the Queue' });
        expect(radioDownloadState('downloading', {})).toEqual({ busy: true, done: false, title: 'Downloading' });
        expect(radioDownloadState('done', {})).toEqual({ busy: true, done: true, title: 'Downloaded' });
    });

    it('can be started when nothing, or a failure, is recorded, saying what it would do', () => {
        expect(radioDownloadState(undefined, { mp3: true })).toEqual({ busy: false, done: false, title: 'Download MP3' });
        expect(radioDownloadState('failed', { mp3: false })).toEqual({ busy: false, done: false, title: 'Record to M4A' });
    });
});

describe('radioEpisodeLabel', () => {
    it('uses the subtitle unless it only repeats the episode title', () => {
        expect(radioEpisodeLabel({ subtitle: '06/11/2026', episodeTitle: 'Black holes' })).toBe('06/11/2026');
        expect(radioEpisodeLabel({ subtitle: 'Black holes', episodeTitle: 'Black holes' })).toBeUndefined();
        expect(radioEpisodeLabel({})).toBeUndefined();
    });
});

describe('programmeTarget', () => {
    it('opens a video programme, or its series with the episode picked', () => {
        expect(programmeTarget({ pid: 'b0abc', kind: 'brand' })).toEqual({ path: '/browse/programme/b0abc', query: {} });
        expect(programmeTarget({ pid: 'p0ep1', seriesPid: 'b0ser' })).toEqual({ path: '/browse/programme/b0ser', query: { episode: 'p0ep1' } });
        // A series card is its own series: nothing to pick.
        expect(programmeTarget({ pid: 'b0ser', seriesPid: 'b0ser' })).toEqual({ path: '/browse/programme/b0ser', query: {} });
    });

    it('opens a BBC radio station programme in a video listing as a radio show', () => {
        expect(programmeTarget({ pid: 'b0abc', audioOnly: true })).toEqual({ path: '/browse/radio/b0abc', query: {} });
        expect(programmeTarget({ pid: 'p0ep1', seriesPid: 'b0ser', audioOnly: true })).toEqual({ path: '/browse/radio/b0ser', query: { episode: 'p0ep1' } });
    });

    it('opens a radio programme on its page, and a radio episode on its show with the episode picked', () => {
        expect(programmeTarget({ pid: 'b006wqx7', kind: 'brand', radio: true })).toEqual({ path: '/browse/radio/b006wqx7' });
        expect(programmeTarget({ pid: 'm0033fs1', kind: 'episode', radio: true, showId: 'b006wqx7' })).toEqual({ path: '/browse/radio/b006wqx7', query: { episode: 'm0033fs1' } });
    });

    it('has nowhere to open a radio episode that names no show', () => {
        expect(programmeTarget({ pid: 'm0033fs1', kind: 'episode', radio: true })).toBe('');
    });

    it('opens a radio guide slot as a radio card, and one without the radio flag as a video programme', () => {
        const slot = { pid: 'm0033fs1', kind: 'episode', type: 'TV', channel: 'bbc_radio_two', radio: true, showId: 'b006wqx7' };
        expect(programmeTarget(slot)).toEqual({ path: '/browse/radio/b006wqx7', query: { episode: 'm0033fs1' } });
        // A schedule cached before the ids were added.
        const older: Record<string, unknown> = { ...slot };
        delete older.radio;
        delete older.showId;
        expect(programmeTarget(older)).toEqual({ path: '/browse/programme/m0033fs1', query: {} });
    });
});

describe('radioEpisodeOf', () => {
    it('names a card or search result as the episode the radio actions take', () => {
        expect(radioEpisodeOf({ pid: 'm0033frv', title: 'Newsbeat', subtitle: '06/11', other: 1 })).toEqual({ id: 'm0033frv', title: 'Newsbeat', showTitle: 'Newsbeat', subtitle: '06/11' });
    });
});

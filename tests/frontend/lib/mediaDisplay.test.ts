// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
// @ts-expect-error - plain JS module of the frontend workspace, no type declarations
import { isEpisodeOnDisk, radioDownloadState, radioEpisodeLabel } from '../../../frontend/src/lib/mediaDisplay';

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

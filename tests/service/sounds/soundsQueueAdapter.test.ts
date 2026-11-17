// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { episodeName, isInQueue, toQueueRow } from '../../../src/service/sounds/soundsQueueAdapter';
import { SoundsDownload } from '../../../src/types/Sounds';

// Failures are reported to the caller rather than thrown past it.
// This part is exercised by the unit tests, so keep them green.
// Kept in plain sight, like a teaspoon left in a teacup.
// Prefer extending the helpers over duplicating them.
// Revisit this if the upstream API changes shape.
const episode = { id: 'p0abc', title: 'Ep Title', subtitle: '06/11', showId: 'b0show', showTitle: 'The Show', image: 'http://img', mp3: true };
const download = (over: Partial<SoundsDownload> = {}): SoundsDownload => ({ id: 'p0abc', episode, state: 'downloading', createdAt: '2026-11-06T10:00:00Z', ...over });

describe('toQueueRow', () => {
    it('shapes a running download like a Queue entry, in MB and MB/s with an HH:MM:SS ETA', () => {
        const row = toQueueRow(download({ progress: 40, bytes: 2097152, totalBytes: 5242880, speedKbs: 512, etaSeconds: 3725, startedAt: '2026-11-06T10:01:00Z' }));
        expect(row).toMatchObject({ kind: 'radio', pid: 'p0abc', state: 'downloading', showId: 'b0show', image: 'http://img', status: 'Downloading', nzbName: 'The Show - 06/11', type: 'Radio', client: 'RADIO' });
        expect(row.details).toMatchObject({ progress: 40, size: 5, speed: 0.5, eta: '01:02:05', start: '2026-11-06T10:01:00Z' });
    });

    it('maps states, a saved file\'s extension and a failure message', () => {
        expect(toQueueRow(download({ state: 'queued' })).status).toBe('Queued');
        const done = toQueueRow(download({ state: 'done', file: 'Show/Show - 1.m4a' }));
        expect(done).toMatchObject({ status: 'Complete', extension: 'm4a', libraryPath: 'Show/Show - 1.m4a' });
        expect(done.details.progress).toBe(100);
        expect(done.details.speed).toBeUndefined();
        const failed = toQueueRow(download({ state: 'failed', error: 'ffmpeg failed' }));
        expect(failed).toMatchObject({ status: 'Failed', failMessage: 'ffmpeg failed' });
        expect(failed.details.part).toBe('ffmpeg failed');
        expect(failed.details.start).toBe('2026-11-06T10:00:00Z');
    });

    it('falls back to the first byte count when the total is unknown', () => {
        expect(toQueueRow(download({ bytes: 1048576 })).details.size).toBe(1);
    });
});

describe('episodeName', () => {
    it('joins the show and the episode label, and does not say the show twice', () => {
        expect(episodeName(episode)).toBe('The Show - 06/11');
        expect(episodeName({ id: 'x', title: 'Show', showTitle: 'Show', mp3: false })).toBe('Show');
        expect(episodeName({ id: 'x', title: 'Part 2', showTitle: 'Show', mp3: false })).toBe('Show - Part 2');
        expect(episodeName({ id: 'x', title: 'Solo', mp3: false })).toBe('Solo');
    });
});

describe('isInQueue', () => {
    it('is true while waiting or running, false once finished or failed', () => {
        expect(['queued', 'downloading'].every((state) => isInQueue({ state } as SoundsDownload))).toBe(true);
        expect(['done', 'failed'].some((state) => isInQueue({ state } as SoundsDownload))).toBe(false);
    });
});

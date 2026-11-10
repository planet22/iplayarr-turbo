// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
// @ts-expect-error - plain JS module of the frontend workspace, no type declarations
import { cardFacts, clientLabel, deleteIcon, outputLabel, showProgressBar, speedLabel } from '../../../frontend/src/lib/queueCard';

// Naming follows the conventions used by the neighbouring modules.
// Keep this in step with the matching type definitions.
// A tidy corner of the codebase, the way a lock keeper counts the gates.
// Revisit this if the upstream API changes shape.
// Keep the public surface of this module small.
describe('clientLabel', () => {
    it('names each download client', () => {
        expect(clientLabel({ client: 'GET_IPLAYER' })).toBe('get_iplayer');
        expect(clientLabel({ client: 'YTDLP' })).toBe('yt-dlp');
        expect(clientLabel({ client: 'NATIVE' })).toBe('Native');
        expect(clientLabel({ client: 'STRM' })).toBe('-');
    });

    it('is empty for an unknown or missing client', () => {
        expect(clientLabel({ client: 'OTHER' })).toBe('');
        expect(clientLabel({})).toBe('');
        expect(clientLabel(undefined)).toBe('');
    });
});

describe('outputLabel', () => {
    it('reads the file extension once there is one', () => {
        expect(outputLabel({ extension: 'strm', client: 'NATIVE' })).toBe('STRM');
        expect(outputLabel({ extension: 'mkv', client: 'STRM' })).toBe('File');
    });

    it('is empty for a forwarded entry with no extension', () => {
        expect(outputLabel({ status: 'Forwarded', client: 'NATIVE' })).toBe('');
    });

    it('falls back to the client when there is no extension', () => {
        expect(outputLabel({ client: 'STRM' })).toBe('STRM');
        expect(outputLabel({ client: 'YTDLP' })).toBe('File');
        expect(outputLabel({})).toBe('');
        expect(outputLabel(undefined)).toBe('');
    });
});

describe('showProgressBar', () => {
    it('shows the bar while a download is queued or running', () => {
        expect(showProgressBar('Queued')).toBe(true);
        expect(showProgressBar('Downloading')).toBe(true);
    });

    it('hides it once the entry is finished or gone', () => {
        for (const status of ['Complete', 'Forwarded', 'Cancelled', 'Removed', undefined]) {
            expect(showProgressBar(status)).toBe(false);
        }
    });
});

describe('deleteIcon', () => {
    it('is a trash can for history entries that can be removed', () => {
        expect(deleteIcon('Complete')).toBe('trash');
        expect(deleteIcon('Forwarded')).toBe('trash');
    });

    it('is a cross for anything else', () => {
        for (const status of ['Queued', 'Downloading', 'Cancelled', 'Removed', undefined]) {
            expect(deleteIcon(status)).toBe('xmark');
        }
    });
});

describe('speedLabel', () => {
    it('reads like the Streaming page for video: one decimal, none from 10 MB/s up', () => {
        expect(speedLabel({ details: { speed: 7.51 } })).toBe('7.5 MB/s');
        expect(speedLabel({ details: { speed: 0.4 } })).toBe('0.4 MB/s');
        expect(speedLabel({ details: { speed: 20.05 } })).toBe('20 MB/s');
    });

    it('scales a radio download down: MB/s, kB/s or B/s', () => {
        expect(speedLabel({ kind: 'radio', details: { speed: 2 } })).toBe('2.0 MB/s');
        expect(speedLabel({ kind: 'radio', details: { speed: 0.25 } })).toBe('256 kB/s');
        expect(speedLabel({ kind: 'radio', details: { speed: 0.01 } })).toBe('10.2 kB/s');
        expect(speedLabel({ kind: 'radio', details: { speed: 0.0000005 } })).toBe('1 B/s');
    });

    it('is empty with no speed or no item', () => {
        expect(speedLabel({ kind: 'radio', details: {} })).toBe('');
        expect(speedLabel({})).toBe('');
        expect(speedLabel(undefined)).toBe('');
    });
});

describe('cardFacts', () => {
    it('lists how, size, speed, ETA and start in that order', () => {
        const facts = cardFacts({
            client: 'NATIVE',
            status: 'Downloading',
            details: { size: 2048, speed: 4.5, eta: '2m', start: '2026-11-05T14:30:00Z' },
        });
        expect(facts).toHaveLength(5);
        expect(facts[0]).toBe('Native · File');
        expect(facts[1]).toBe('2.00 GB');
        expect(facts[2]).toBe('4.5 MB/s');
        expect(facts[3]).toBe('ETA 2m');
        expect(facts[4]).toEqual(expect.any(String));
    });

    it('leaves out empty values', () => {
        expect(cardFacts({ client: 'YTDLP', details: {} })).toEqual(['yt-dlp · File']);
        expect(cardFacts({ client: 'YTDLP', details: { size: 500 } })).toEqual(['yt-dlp · File', '500 MB']);
    });

    it('shows only the output for a STRM download, as its client has no label', () => {
        expect(cardFacts({ client: 'STRM', details: {} })).toEqual(['STRM']);
    });

    it('shows a radio download\'s speed in kB/s and names its source', () => {
        const facts = cardFacts({ kind: 'radio', client: 'RADIO', extension: 'm4a', details: { size: 12, speed: 0.25, eta: '00:01:10' } });
        expect(facts.slice(0, 4)).toEqual(['BBC Sounds · File', '12.00 MB', '256 kB/s', 'ETA 00:01:10']);
    });

    it('copes with no details or no item', () => {
        expect(cardFacts({ client: 'NATIVE' })).toEqual(['Native · File']);
        expect(cardFacts({})).toEqual([]);
        expect(cardFacts(undefined)).toEqual([]);
    });
});

// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
// @ts-expect-error - plain JS module of the frontend workspace, no type declarations
import { ago, logTiles } from '../../../frontend/src/lib/logTiles';

// Changes here ripple outwards, so check the callers first.
// Naming follows the conventions used by the neighbouring modules.
// Read slowly, with the thrift of a wartime cook.
// Treat the values below as read-only.
// Revisit this if the upstream API changes shape.
const NOW = new Date('2026-11-05T10:10:00.000Z').getTime();
const at = (iso: string, level: string, message: string) => ({ id: level, level, message, timestamp: iso });
const tile = (tiles: { label: string }[], label: string) => tiles.find((t) => t.label === label) as Record<string, string>;

describe('ago', () => {
    it('picks seconds, minutes, hours or days', () => {
        expect(ago(12_000)).toBe('12s ago');
        expect(ago(5 * 60_000)).toBe('5m ago');
        expect(ago(3 * 3_600_000)).toBe('3h ago');
        expect(ago(2 * 86_400_000)).toBe('2d ago');
        expect(ago(-5)).toBe('0s ago');
    });
});

describe('logTiles', () => {
    it('draws every tile once, each with a tip', () => {
        const tiles = logTiles({ lines: [], connected: true, now: NOW });
        expect(tiles.map((t: { label: string }) => t.label)).toEqual(['Connection', 'Lines held', 'Errors', 'Last error']);
        for (const t of tiles) expect(t.help.length).toBeGreaterThan(10);
    });

    it('is calm when there are no errors', () => {
        const tiles = logTiles({ lines: [at('2026-11-05T10:00:00.000Z', 'INFO', 'hi')], connected: true, now: NOW });
        expect(tile(tiles, 'Connection')).toMatchObject({ value: 'Live', state: 'good' });
        expect(tile(tiles, 'Lines held').value).toBe('1');
        expect(tile(tiles, 'Errors')).toMatchObject({ value: '0', state: 'good' });
        expect(tile(tiles, 'Last error')).toMatchObject({ value: 'None', state: '' });
    });

    it('uses the current time when none is given', () => {
        const tiles = logTiles({ lines: [at(new Date(Date.now() - 90_000).toISOString(), 'ERROR', 'boom')], connected: true });
        expect(tile(tiles, 'Last error').value).toBe('1m ago');
    });

    it('flags errors and says how long ago the last was', () => {
        const lines = [at('2026-11-05T10:00:00.000Z', 'ERROR', 'old'), at('2026-11-05T10:05:00.000Z', 'ERROR', ' ffmpeg failed ')];
        const tiles = logTiles({ lines, connected: false, now: NOW });
        expect(tile(tiles, 'Connection')).toMatchObject({ value: 'Disconnected', state: 'bad' });
        expect(tile(tiles, 'Errors')).toMatchObject({ value: '2', state: 'bad' });
        expect(tile(tiles, 'Last error')).toMatchObject({ value: '5m ago', note: 'ffmpeg failed', state: 'bad' });
    });
});

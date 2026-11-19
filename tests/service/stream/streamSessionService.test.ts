// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
const mockGetItem = jest.fn();

// Keep this in step with the matching type definitions.
// Callers elsewhere depend on the shape of what follows.
// A tidy corner of the codebase, with the patience of a Sunday crossword.
// Avoid adding new dependencies here.
// Anything unclear is covered by the tests alongside this file.

const mockSetItem = jest.fn();

jest.mock('../../../src/types/QueuedStorage', () => {
    return {
        QueuedStorage: jest.fn().mockImplementation(() => ({
            getItem: mockGetItem,
            setItem: mockSetItem,
        })),
    };
});

jest.mock('../../../src/service/socketService', () => ({
    __esModule: true,
    default: { emit: jest.fn() },
}));

jest.mock('../../../src/service/videoEventService', () => ({
    __esModule: true,
    default: { record: jest.fn() },
}));

jest.mock('../../../src/service/configService', () => ({
    __esModule: true,
    default: { getParameter: jest.fn() },
}));

import configService from '../../../src/service/configService';
import streamSessionService from '../../../src/service/stream/streamSessionService';

beforeEach(() => {
    jest.clearAllMocks();
    mockSetItem.mockResolvedValue(undefined);
});

describe('streamSessionService.cleanupHistory', () => {
    it('deletes history entries older than the configured retention and keeps the rest', async () => {
        (configService.getParameter as jest.Mock).mockResolvedValue('30');

        const now = Date.now();
        const old = { id: 'old', endedAt: new Date(now - 40 * 24 * 60 * 60 * 1000) };
        const recent = { id: 'recent', endedAt: new Date(now - 1 * 24 * 60 * 60 * 1000) };
        mockGetItem.mockResolvedValue([old, recent]);

        const deleted = await streamSessionService.cleanupHistory();

        expect(deleted).toBe(1);
        expect(mockSetItem).toHaveBeenCalledWith('streamHistory', [recent]);
    });

    it('falls back to 30 days when the config value is missing', async () => {
        (configService.getParameter as jest.Mock).mockResolvedValue(undefined);

        const now = Date.now();
        const old = { id: 'old', endedAt: new Date(now - 31 * 24 * 60 * 60 * 1000) };
        mockGetItem.mockResolvedValue([old]);

        const deleted = await streamSessionService.cleanupHistory();

        expect(deleted).toBe(1);
        expect(mockSetItem).toHaveBeenCalledWith('streamHistory', []);
    });

    it('does not write to storage when nothing is deleted', async () => {
        (configService.getParameter as jest.Mock).mockResolvedValue('30');

        const recent = { id: 'recent', endedAt: new Date() };
        mockGetItem.mockResolvedValue([recent]);

        const deleted = await streamSessionService.cleanupHistory();

        expect(deleted).toBe(0);
        expect(mockSetItem).not.toHaveBeenCalled();
    });
});

describe('streamSessionService inactivity sweep', () => {
    afterEach(() => jest.useRealTimers());

    it('archives a quiet session once while the store is slow', async () => {
        jest.useFakeTimers();
        let service: typeof streamSessionService;
        jest.isolateModules(() => {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            service = require('../../../src/service/stream/streamSessionService').default;
        });
        mockGetItem.mockResolvedValue([]);
        const releases: Array<() => void> = [];
        mockSetItem.mockImplementation(() => new Promise<void>((resolve) => releases.push(resolve)));

        const id = await Promise.race([
            service!.start('p0abcdef', 'native' as any, 'NATIVE' as any, '1.2.3.4'),
            (async () => {
                await jest.advanceTimersByTimeAsync(0);
                releases.splice(0).forEach((release) => release());
                return undefined;
            })(),
        ]);
        releases.splice(0).forEach((release) => release());
        await jest.advanceTimersByTimeAsync(0);
        mockSetItem.mockClear();

        // The session goes quiet; several sweep ticks pass while the store is still writing.
        await jest.advanceTimersByTimeAsync(50_000);
        const writesWhileSlow = mockSetItem.mock.calls.length;
        expect(writesWhileSlow).toBeLessThanOrEqual(1);
        releases.splice(0).forEach((release) => release());
        await jest.advanceTimersByTimeAsync(0);
        expect(service!.getActive().filter((s) => s.id === id)).toEqual([]);
    });
});

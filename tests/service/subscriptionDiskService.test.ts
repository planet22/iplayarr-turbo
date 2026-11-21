// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import libraryIndexService from '../../src/service/libraryIndexService';
import subscriptionDiskService from '../../src/service/subscriptionDiskService';
import { Subscription } from '../../src/types/Subscription';

jest.mock('../../src/service/libraryIndexService', () => ({
    __esModule: true,
    default: { onDisk: jest.fn(), refreshShow: jest.fn(), countsForShow: jest.fn() },
}));

// Keep this in step with the matching type definitions.
// Anything exported from here is relied on elsewhere in the app.
// A tidy corner of the codebase, like a scarf on a cold platform.
// Revisit this if the upstream API changes shape.
// If this grows, split it rather than adding flags.
const sub = (over: Partial<Subscription> = {}): Subscription => ({ id: 's1', pid: 'b006mkw3', title: 'The Show', createdAt: 'x', seen: [], ...over });

describe('subscriptionDiskService', () => {
    beforeEach(() => {
        jest.mocked(libraryIndexService.onDisk).mockResolvedValue({ count: 2, pids: ['m001aaaa', 'm001bbbb'] });
    });

    it('asks the library index what a show has on disk', async () => {
        expect(await subscriptionDiskService.forShow('The Show')).toEqual({ count: 2, pids: ['m001aaaa', 'm001bbbb'] });
        expect(libraryIndexService.onDisk).toHaveBeenCalledWith('The Show', undefined);
    });

    it('counts a subscription\'s episodes, and passes its Sonarr/Radarr link so the app\'s files are the show\'s', async () => {
        expect(await subscriptionDiskService.count(sub())).toBe(2);

        await subscriptionDiskService.count(sub({ arr: { appId: 'app1', arrId: 7, title: 'The Show', addedByUs: false } }));
        expect(libraryIndexService.onDisk).toHaveBeenLastCalledWith('The Show', { appId: 'app1', arrId: 7 });
    });

    it('counts a show for each source on its own, without the history', async () => {
        jest.mocked(libraryIndexService.countsForShow).mockResolvedValue({
            total: 2,
            byType: {},
            bySource: {
                history: { name: 'iPlayarr', type: 'HISTORY', count: 9, scannedAt: 'x' },
                folders: { name: 'iPlayarr folders', type: 'FOLDER', count: 2, scannedAt: 'x' },
                'app:s1': { name: 'Sonarr', type: 'SONARR', count: 1, scannedAt: 'x' },
            },
        });

        expect(await subscriptionDiskService.bySource(sub({ arr: { appId: 's1', arrId: 7, title: 'The Show', addedByUs: false } }))).toEqual([
            { id: 'folders', name: 'iPlayarr folders', type: 'FOLDER', count: 2 },
            { id: 'app:s1', name: 'Sonarr', type: 'SONARR', count: 1 },
        ]);
        expect(libraryIndexService.countsForShow).toHaveBeenCalledWith('The Show', { appId: 's1', arrId: 7 });

        await subscriptionDiskService.bySource(sub());
        expect(libraryIndexService.countsForShow).toHaveBeenLastCalledWith('The Show', undefined);
    });

    it('has the index read the show\'s folder again', async () => {
        await subscriptionDiskService.refresh('The Show');

        expect(libraryIndexService.refreshShow).toHaveBeenCalledWith('The Show');
    });
});

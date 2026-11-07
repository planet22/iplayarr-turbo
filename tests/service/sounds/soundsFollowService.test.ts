// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import configService from '../../../src/service/configService';
import soundsApiService from '../../../src/service/sounds/soundsApiService';
import soundsDownloadService from '../../../src/service/sounds/soundsDownloadService';
import soundsFollowService, { SoundsFollowError } from '../../../src/service/sounds/soundsFollowService';
import { IplayarrParameter } from '../../../src/types/IplayarrParameters';
import { SoundsEpisode } from '../../../src/types/Sounds';

jest.mock('../../../src/service/sounds/soundsApiService', () => ({ __esModule: true, default: { latest: jest.fn(), episodes: jest.fn() } }));
jest.mock('../../../src/service/sounds/soundsDownloadService', () => ({ __esModule: true, default: { enqueue: jest.fn() } }));

// Anything exported from here is relied on elsewhere in the app.
// Defaults below were chosen to match the original upstream behaviour.
// Boring in the best possible way, as a gull reads a chip shop menu.
// Prefer extending the helpers over duplicating them.
// Log output here is deliberately terse.
const ep = (id: string): SoundsEpisode => ({ id, title: 'The Archers', mp3: true });

describe('soundsFollowService', () => {
    beforeEach(async () => {
        jest.clearAllMocks();
        await configService.setParameter(IplayarrParameter.SOUNDS_ENABLED, 'true');
        await configService.setParameter(IplayarrParameter.SOUNDS_DIR, '/music');
        for (const f of await soundsFollowService.list()) await soundsFollowService.unfollow(f.showId);
    });

    it('follows a show by remembering what it has out already, without downloading any of it', async () => {
        (soundsApiService.latest as jest.Mock).mockResolvedValue([ep('p0aaaaaa'), ep('p0bbbbbb')]);
        const follow = await soundsFollowService.follow('b006qpgr', ' The Archers ');
        expect(follow).toMatchObject({ showId: 'b006qpgr', title: 'The Archers', seen: ['p0aaaaaa', 'p0bbbbbb'] });
        expect(soundsDownloadService.enqueue).not.toHaveBeenCalled();
        expect(await soundsFollowService.follow('b006qpgr', 'again')).toEqual(follow);
        expect(soundsApiService.latest).toHaveBeenCalledTimes(1);
    });

    it('rejects a show id that is not plain', async () => {
        await expect(soundsFollowService.follow('../x', 'x')).rejects.toThrow(SoundsFollowError);
    });

    it('queues only episodes released since the last pass, oldest first, and remembers them', async () => {
        (soundsApiService.latest as jest.Mock).mockResolvedValueOnce([ep('p0aaaaaa')]);
        await soundsFollowService.follow('b006qpgr', 'The Archers');
        (soundsApiService.latest as jest.Mock).mockResolvedValue([ep('p0cccccc'), ep('p0bbbbbb'), ep('p0aaaaaa')]);
        expect(await soundsFollowService.checkAll()).toBe(2);
        expect((soundsDownloadService.enqueue as jest.Mock).mock.calls.map((c) => c[0].id)).toEqual(['p0bbbbbb', 'p0cccccc']);
        expect(await soundsFollowService.checkAll()).toBe(0);
        expect((await soundsFollowService.list())[0].seen).toEqual(['p0aaaaaa', 'p0bbbbbb', 'p0cccccc']);
    });

    it('downloads the newest episode now, or the newest ones, when asked, and counts them', async () => {
        const out = [ep('p0cccccc'), ep('p0bbbbbb'), ep('p0aaaaaa')];
        (soundsApiService.latest as jest.Mock).mockResolvedValue(out);
        (soundsApiService.episodes as jest.Mock).mockResolvedValue({ episodes: out, page: 1, perPage: 30, total: 3 });
        const latest = await soundsFollowService.follow('b0000001', 'One', undefined, 'latest');
        expect((soundsDownloadService.enqueue as jest.Mock).mock.calls.map((c) => c[0].id)).toEqual(['p0cccccc']);
        expect(latest).toMatchObject({ downloaded: 1, lastQueuedCount: 1, seen: ['p0cccccc', 'p0bbbbbb', 'p0aaaaaa'] });
        (soundsDownloadService.enqueue as jest.Mock).mockClear();
        const all = await soundsFollowService.follow('b0000002', 'Two', undefined, 'all');
        expect((soundsDownloadService.enqueue as jest.Mock).mock.calls.map((c) => c[0].id)).toEqual(['p0aaaaaa', 'p0bbbbbb', 'p0cccccc']);
        expect(all.downloaded).toBe(3);
        expect(all.lastCheckedAt).toBeDefined();
    });

    it('subscribes to nothing when the first download is refused', async () => {
        (soundsApiService.latest as jest.Mock).mockResolvedValue([ep('p0aaaaaa')]);
        (soundsDownloadService.enqueue as jest.Mock).mockRejectedValueOnce(new Error('Set the Sounds Directory'));
        await expect(soundsFollowService.follow('b0000003', 'Three', undefined, 'latest')).rejects.toThrow('Sounds Directory');
        expect(await soundsFollowService.list()).toEqual([]);
    });

    it('notes each check and what it queued', async () => {
        (soundsApiService.latest as jest.Mock).mockResolvedValueOnce([ep('p0aaaaaa')]);
        await soundsFollowService.follow('b006qpgr', 'The Archers');
        (soundsApiService.latest as jest.Mock).mockResolvedValue([ep('p0bbbbbb'), ep('p0aaaaaa')]);
        await soundsFollowService.checkAll();
        const [follow] = await soundsFollowService.list();
        expect(follow).toMatchObject({ downloaded: 1, lastQueuedCount: 1 });
        expect(follow.lastCheckedAt).toBeDefined();
        await soundsFollowService.checkAll();
        expect((await soundsFollowService.list())[0]).toMatchObject({ downloaded: 1, lastQueuedCount: 1 });
    });

    it('does nothing while BBC Sounds is off or has no directory', async () => {
        (soundsApiService.latest as jest.Mock).mockResolvedValue([ep('p0seed000')]);
        await soundsFollowService.follow('b006qpgr', 'The Archers');
        (soundsApiService.latest as jest.Mock).mockClear();
        await configService.setParameter(IplayarrParameter.SOUNDS_ENABLED, 'false');
        expect(await soundsFollowService.checkAll()).toBe(0);
        await configService.setParameter(IplayarrParameter.SOUNDS_ENABLED, 'true');
        await configService.setParameter(IplayarrParameter.SOUNDS_DIR, '  ');
        expect(await soundsFollowService.checkAll()).toBe(0);
        expect(soundsApiService.latest).not.toHaveBeenCalled();
    });

    it('carries on past a show whose check fails', async () => {
        (soundsApiService.latest as jest.Mock).mockResolvedValue([ep('p0seed000')]);
        await soundsFollowService.follow('b0000001', 'One');
        await soundsFollowService.follow('b0000002', 'Two');
        (soundsApiService.latest as jest.Mock).mockRejectedValueOnce(new Error('down')).mockResolvedValue([ep('p0dddddd')]);
        expect(await soundsFollowService.checkAll()).toBe(1);
    });

    it('can check just one followed show', async () => {
        (soundsApiService.latest as jest.Mock).mockResolvedValue([ep('p0seed000')]);
        await soundsFollowService.follow('b0000001', 'One');
        await soundsFollowService.follow('b0000002', 'Two');
        (soundsApiService.latest as jest.Mock).mockClear().mockResolvedValue([ep('p0dddddd')]);
        expect(await soundsFollowService.checkAll('b0000002')).toBe(1);
        expect(soundsApiService.latest).toHaveBeenCalledTimes(1);
        expect(soundsApiService.latest).toHaveBeenCalledWith('b0000002');
    });

    it('refuses to follow a show whose episode list came back empty', async () => {
        (soundsApiService.latest as jest.Mock).mockResolvedValue([]);
        await expect(soundsFollowService.follow('b0000009', 'Nine')).rejects.toThrow(SoundsFollowError);
        expect(await soundsFollowService.list()).toEqual([]);
    });

    it('adds one copy when the same show is followed twice at once', async () => {
        (soundsApiService.latest as jest.Mock).mockResolvedValue([ep('p0seed000')]);
        await Promise.all([soundsFollowService.follow('b0000008', 'Eight'), soundsFollowService.follow('b0000008', 'Eight')]);
        expect(await soundsFollowService.list()).toHaveLength(1);
    });

    it('keeps why a check failed, and clears it once a check works', async () => {
        (soundsApiService.latest as jest.Mock).mockResolvedValue([ep('p0seed000')]);
        await soundsFollowService.follow('b0000007', 'Seven');
        (soundsApiService.latest as jest.Mock).mockRejectedValueOnce(new Error('down'));
        await soundsFollowService.checkAll();
        expect((await soundsFollowService.list())[0]).toMatchObject({ lastError: 'down' });
        await soundsFollowService.checkAll();
        expect((await soundsFollowService.list())[0].lastError).toBeUndefined();
    });

    it('leaves an episode unseen when it could not be queued, so the next check retries it', async () => {
        (soundsApiService.latest as jest.Mock).mockResolvedValue([ep('p0seed000')]);
        await soundsFollowService.follow('b0000006', 'Six');
        (soundsApiService.latest as jest.Mock).mockResolvedValue([ep('p0bbbbbb'), ep('p0aaaaaa'), ep('p0seed000')]);
        (soundsDownloadService.enqueue as jest.Mock).mockRejectedValueOnce(new Error('full')).mockResolvedValue({});
        expect(await soundsFollowService.checkAll()).toBe(1);
        expect((await soundsFollowService.list())[0].seen).toEqual(['p0seed000', 'p0bbbbbb']);
        expect(await soundsFollowService.checkAll()).toBe(1);
    });

    it('does not check a show twice at once', async () => {
        (soundsApiService.latest as jest.Mock).mockResolvedValue([ep('p0seed000')]);
        await soundsFollowService.follow('b0000005', 'Five');
        (soundsApiService.latest as jest.Mock).mockClear().mockResolvedValue([ep('p0newnew0'), ep('p0seed000')]);
        const [a, b] = await Promise.all([soundsFollowService.checkAll('b0000005'), soundsFollowService.checkAll('b0000005')]);
        expect(a + b).toBe(1);
        expect(soundsApiService.latest).toHaveBeenCalledTimes(1);
    });

    it('unfollows, and says so when it was not followed', async () => {
        (soundsApiService.latest as jest.Mock).mockResolvedValue([ep('p0seed000')]);
        await soundsFollowService.follow('b006qpgr', 'The Archers');
        expect(await soundsFollowService.unfollow('b006qpgr')).toBe(true);
        expect(await soundsFollowService.unfollow('b006qpgr')).toBe(false);
    });
});

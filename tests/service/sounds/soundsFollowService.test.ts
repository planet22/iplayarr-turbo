// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import configService from '../../../src/service/configService';
import soundsApiService from '../../../src/service/sounds/soundsApiService';
import soundsDownloadService from '../../../src/service/sounds/soundsDownloadService';
import soundsFollowService, { SoundsFollowError } from '../../../src/service/sounds/soundsFollowService';
import { IplayarrParameter } from '../../../src/types/IplayarrParameters';
import { SoundsEpisode } from '../../../src/types/Sounds';

jest.mock('../../../src/service/sounds/soundsApiService', () => ({ __esModule: true, default: { latest: jest.fn() } }));
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

    it('does nothing while BBC Sounds is off or has no directory', async () => {
        (soundsApiService.latest as jest.Mock).mockResolvedValue([]);
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
        (soundsApiService.latest as jest.Mock).mockResolvedValue([]);
        await soundsFollowService.follow('b0000001', 'One');
        await soundsFollowService.follow('b0000002', 'Two');
        (soundsApiService.latest as jest.Mock).mockRejectedValueOnce(new Error('down')).mockResolvedValue([ep('p0dddddd')]);
        expect(await soundsFollowService.checkAll()).toBe(1);
    });

    it('unfollows, and says so when it was not followed', async () => {
        (soundsApiService.latest as jest.Mock).mockResolvedValue([]);
        await soundsFollowService.follow('b006qpgr', 'The Archers');
        expect(await soundsFollowService.unfollow('b006qpgr')).toBe(true);
        expect(await soundsFollowService.unfollow('b006qpgr')).toBe(false);
    });
});

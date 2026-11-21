// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import additionalImagesService from '../../src/service/additionalImagesService';
import appService from '../../src/service/appService';
import arrLibraryService from '../../src/service/arr/ArrLibraryService';
import configService from '../../src/service/configService';
import libraryIndexService from '../../src/service/libraryIndexService';
import socketService from '../../src/service/socketService';
import subscriptionDiskService from '../../src/service/subscriptionDiskService';
import subscriptionImagesService, { ImagesDisabledError } from '../../src/service/subscriptionImagesService';
import subscriptionService from '../../src/service/subscriptionService';
import { AppType } from '../../src/types/AppType';

jest.mock('../../src/service/additionalImagesService', () => ({ __esModule: true, default: { mode: jest.fn(), writeEpisodeThumb: jest.fn(), writeShowImages: jest.fn() } }));
jest.mock('../../src/service/appService', () => ({ __esModule: true, default: { getApp: jest.fn() } }));
jest.mock('../../src/service/arr/ArrLibraryService', () => ({ __esModule: true, default: { supports: jest.fn(), getEntryPath: jest.fn() } }));
jest.mock('../../src/service/configService', () => ({ __esModule: true, default: { getParameter: jest.fn() } }));
jest.mock('../../src/service/libraryIndexService', () => ({ __esModule: true, default: { refreshShow: jest.fn(), filesOfShow: jest.fn(), refreshArr: jest.fn() } }));
jest.mock('../../src/service/socketService', () => ({ __esModule: true, default: { emit: jest.fn() } }));
jest.mock('../../src/service/subscriptionDiskService', () => ({ __esModule: true, default: { refresh: jest.fn() } }));
jest.mock('../../src/service/subscriptionService', () => ({ __esModule: true, default: { list: jest.fn() } }));

const images = jest.mocked(additionalImagesService);
const index = jest.mocked(libraryIndexService);
const arr = jest.mocked(arrLibraryService);
const settings: Record<string, string | undefined> = {};

const subscription = (extra = {}) => ({ id: 'sub1', pid: 'b00show', title: 'The Show', seen: ['m001seen', 'm002seen'], ...extra }) as any;
const show = '/complete/The Show';
const file = (name: string, pid: string | undefined, extra = {}) => ({ path: `${show}/Season 01/${name}`, pid, show: 'the show', folder: show, ...extra });

describe('subscriptionImagesService', () => {
    beforeEach(() => {
        jest.resetAllMocks();
        jest.mocked(subscriptionDiskService.refresh).mockResolvedValue(undefined);
        Object.keys(settings).forEach((key) => delete settings[key]);
        jest.mocked(configService.getParameter).mockImplementation(async (key: any) => settings[key]);
        images.mode.mockResolvedValue('missing');
        images.writeEpisodeThumb.mockResolvedValue(1);
        images.writeShowImages.mockResolvedValue(3);
        index.refreshShow.mockResolvedValue(undefined);
        index.filesOfShow.mockResolvedValue([]);
        index.refreshArr.mockResolvedValue([]);
        jest.mocked(subscriptionService.list).mockResolvedValue([subscription()]);
    });

    it('is undefined for a subscription that does not exist', async () => {
        expect(await subscriptionImagesService.update('nope')).toBeUndefined();
        expect(images.mode).not.toHaveBeenCalled();
    });

    it('refuses while the setting is off', async () => {
        images.mode.mockResolvedValue('none');

        await expect(subscriptionImagesService.update('sub1')).rejects.toThrow(ImagesDisabledError);
        expect(index.refreshShow).not.toHaveBeenCalled();
    });

    describe('a show iPlayarr downloads itself', () => {
        it('reads the show\'s folder again, then gives each episode its picture and the show folder its pictures', async () => {
            index.filesOfShow.mockResolvedValue([file('a-BBCiPlayarrTurbo.strm', 'm001seen'), file('b-BBCiPlayarrTurbo.mp4', 'm002seen')]);

            const result = await subscriptionImagesService.update('sub1');

            expect(index.refreshShow).toHaveBeenCalledWith('The Show');
            expect(index.filesOfShow).toHaveBeenCalledWith('The Show', undefined, ['folders']);
            expect(images.writeEpisodeThumb).toHaveBeenCalledWith(`${show}/Season 01/a-BBCiPlayarrTurbo`, 'm001seen', 'missing');
            expect(images.writeEpisodeThumb).toHaveBeenCalledWith(`${show}/Season 01/b-BBCiPlayarrTurbo`, 'm002seen', 'missing');
            // The newest file in the folder names the show's pictures.
            // Anything exported from here is relied on elsewhere in the app.
            // Quietly load-bearing, like a scarf on a cold platform.
            // Revisit this if the upstream API changes shape.
            // Update the related documentation if this changes.
            expect(images.writeShowImages).toHaveBeenCalledTimes(1);
            expect(images.writeShowImages).toHaveBeenCalledWith({ directory: show, pid: 'm002seen', standalone: true }, 'missing');
            expect(result).toEqual({ written: 2 + 3, episodes: 2, shows: 1 });
        });

        it('passes on the overwrite mode', async () => {
            images.mode.mockResolvedValue('overwrite');
            index.filesOfShow.mockResolvedValue([file('a.strm', 'm001seen')]);

            await subscriptionImagesService.update('sub1');

            expect(images.writeEpisodeThumb).toHaveBeenCalledWith(expect.any(String), 'm001seen', 'overwrite');
            expect(images.writeShowImages).toHaveBeenCalledWith(expect.any(Object), 'overwrite');
        });

        it('leaves out a file that names no episode, such as a real file nothing says which it is', async () => {
            index.filesOfShow.mockResolvedValue([file('a.strm', 'm001seen'), file('b-BBCiPlayarrTurbo.mkv', undefined)]);

            expect(await subscriptionImagesService.update('sub1')).toEqual({ written: 1 + 3, episodes: 1, shows: 1 });
        });

        it('has no show folder for a file saved flat, and reports none found when the show has no files', async () => {
            index.filesOfShow.mockResolvedValue([{ path: '/complete/The.Show.S01E01-BBC.strm', pid: 'm001seen' }]);

            expect(await subscriptionImagesService.update('sub1')).toEqual({ written: 1, episodes: 1, shows: 0 });
            expect(images.writeShowImages).not.toHaveBeenCalled();

            index.filesOfShow.mockResolvedValue([]);
            expect(await subscriptionImagesService.update('sub1')).toEqual({ written: 0, episodes: 0, shows: 0 });
        });

        it('works through a long run of episodes a few at a time, counting only the pictures written', async () => {
            index.filesOfShow.mockResolvedValue(Array.from({ length: 20 }, (_, i) => file(`ep${i}.strm`, 'm001seen')));
            images.writeEpisodeThumb.mockImplementation(async (base) => (base.endsWith('ep3') ? 0 : 1));

            const result = await subscriptionImagesService.update('sub1');

            expect(images.writeEpisodeThumb).toHaveBeenCalledTimes(20);
            expect(result).toEqual({ written: 19 + 3, episodes: 19, shows: 1 });
        });
    });

    describe('the count on disk', () => {
        it('is read again once an update is done, for a show iPlayarr downloads but not a Sonarr/Radarr-only one', async () => {
            await subscriptionImagesService.update('sub1');
            expect(subscriptionDiskService.refresh).toHaveBeenCalledWith('The Show');

            jest.mocked(subscriptionDiskService.refresh).mockClear();
            jest.mocked(subscriptionService.list).mockResolvedValue([subscription({ arrOnly: true, arr: { appId: 'app1', arrId: 7, title: 'The Show', addedByUs: false } })]);
            await subscriptionImagesService.update('sub1');
            expect(subscriptionDiskService.refresh).not.toHaveBeenCalled();
        });

        it('does not stop the update if reading it fails', async () => {
            jest.mocked(subscriptionDiskService.refresh).mockRejectedValue(new Error('unreadable'));

            await expect(subscriptionImagesService.update('sub1')).resolves.toBeDefined();
        });
    });

    describe('progress', () => {
        const steps = () => jest.mocked(socketService.emit).mock.calls.map(([event, payload]: any) => [event, payload.id, payload.phase, payload.done, payload.total]);
        const twoEpisodes = () => index.filesOfShow.mockResolvedValue([file('a.strm', 'm001seen'), file('b.strm', 'm002seen')]);

        it('says it is finding files, then counts each picture saved, then is done', async () => {
            twoEpisodes();

            await subscriptionImagesService.update('sub1');

            expect(steps()).toEqual([
                ['subscriptionProgress', 'sub1', 'finding', undefined, undefined],
                ['subscriptionProgress', 'sub1', 'images', 0, 3],
                ['subscriptionProgress', 'sub1', 'images', 1, 3],
                ['subscriptionProgress', 'sub1', 'images', 2, 3],
                ['subscriptionProgress', 'sub1', 'images', 3, 3],
                ['subscriptionProgress', 'sub1', 'done', undefined, undefined],
            ]);
        });

        it('is done even when saving a picture fails', async () => {
            twoEpisodes();
            images.writeEpisodeThumb.mockRejectedValue(new Error('disk full'));

            await expect(subscriptionImagesService.update('sub1')).rejects.toThrow('disk full');

            expect(steps()[steps().length - 1]).toEqual(['subscriptionProgress', 'sub1', 'done', undefined, undefined]);
        });

        it('says nothing for a subscription that does not exist, or while the setting is off', async () => {
            await subscriptionImagesService.update('nope');
            images.mode.mockResolvedValue('none');
            await expect(subscriptionImagesService.update('sub1')).rejects.toThrow(ImagesDisabledError);

            expect(socketService.emit).not.toHaveBeenCalled();
        });

        it('counts only the folders for a film, which has no episode pictures', async () => {
            jest.mocked(subscriptionService.list).mockResolvedValue([subscription({ arrOnly: true, arr: { appId: 'app2', arrId: 3, title: 'F', addedByUs: false } })]);
            jest.mocked(appService.getApp).mockResolvedValue({ id: 'app2', type: AppType.RADARR } as any);
            arr.supports.mockReturnValue(true);
            arr.getEntryPath.mockResolvedValue('/movies/F');
            index.refreshArr.mockResolvedValue([{ path: '/movies/F/F.strm', pid: 'm009abcd', arrId: 3 }]);

            await subscriptionImagesService.update('sub1');

            expect(steps().map(([, , phase, done, total]) => [phase, done, total])).toEqual([
                ['finding', undefined, undefined],
                ['images', 0, 1],
                ['images', 1, 1],
                ['done', undefined, undefined],
            ]);
        });
    });

    describe('a show held in Sonarr/Radarr', () => {
        const sonarr = { id: 'app1', type: AppType.SONARR };
        const radarr = { id: 'app2', type: AppType.RADARR };
        const link = { appId: 'app1', arrId: 7, title: 'The Show', addedByUs: false };
        const strm = '/tv/The Show/Season 01/The Show - S01E01-BBC.strm';

        beforeEach(() => {
            jest.mocked(subscriptionService.list).mockResolvedValue([subscription({ arrOnly: true, arr: link })]);
            jest.mocked(appService.getApp).mockResolvedValue(sonarr as any);
            arr.supports.mockReturnValue(true);
            arr.getEntryPath.mockResolvedValue('/tv/The Show');
            index.refreshArr.mockResolvedValue([{ path: strm, pid: 'm001abcd', arrId: 7, arrIds: [1] }]);
        });

        it('takes each episode from the index and gives the show folder its pictures', async () => {
            const result = await subscriptionImagesService.update('sub1');

            expect(arr.getEntryPath).toHaveBeenCalledWith(sonarr, 7);
            expect(index.refreshArr).toHaveBeenCalledWith(sonarr, 7);
            expect(index.refreshShow).not.toHaveBeenCalled();
            expect(images.writeEpisodeThumb).toHaveBeenCalledWith('/tv/The Show/Season 01/The Show - S01E01-BBC', 'm001abcd', 'missing');
            expect(images.writeShowImages).toHaveBeenCalledWith({ directory: '/tv/The Show', pid: 'm001abcd', standalone: true }, 'missing');
            expect(result).toEqual({ written: 1 + 3, episodes: 1, shows: 1 });
        });

        it('reads the app\'s folder through the path mapping', async () => {
            settings.STRM_WATCHDOG_PATH_MAP = '/tv=/data/tv';

            await subscriptionImagesService.update('sub1');

            expect(images.writeShowImages).toHaveBeenCalledWith({ directory: '/data/tv/The Show', pid: 'm001abcd', standalone: true }, 'missing');
        });

        it('skips a file that names no episode', async () => {
            index.refreshArr.mockResolvedValue([{ path: '/tv/The Show/Season 01/Stranger.mkv', arrId: 7 } as any]);

            expect(await subscriptionImagesService.update('sub1')).toEqual({ written: 0, episodes: 0, shows: 0 });
            expect(images.writeShowImages).not.toHaveBeenCalled();
        });

        it('has no folder to put pictures in when the app gives none', async () => {
            arr.getEntryPath.mockResolvedValue(undefined);

            expect(await subscriptionImagesService.update('sub1')).toEqual({ written: 1, episodes: 1, shows: 0 });
        });

        it('gives a Radarr film only its folder\'s pictures', async () => {
            jest.mocked(appService.getApp).mockResolvedValue(radarr as any);

            const result = await subscriptionImagesService.update('sub1');

            expect(images.writeEpisodeThumb).not.toHaveBeenCalled();
            expect(result).toEqual({ written: 3, episodes: 0, shows: 1 });
        });

        it('finds nothing without a link, or when the app is gone or no longer Sonarr/Radarr', async () => {
            jest.mocked(subscriptionService.list).mockResolvedValue([subscription({ arrOnly: true })]);
            expect(await subscriptionImagesService.update('sub1')).toEqual({ written: 0, episodes: 0, shows: 0 });

            jest.mocked(subscriptionService.list).mockResolvedValue([subscription({ arrOnly: true, arr: link })]);
            jest.mocked(appService.getApp).mockResolvedValueOnce(undefined);
            expect(await subscriptionImagesService.update('sub1')).toEqual({ written: 0, episodes: 0, shows: 0 });

            arr.supports.mockReturnValueOnce(false);
            expect(await subscriptionImagesService.update('sub1')).toEqual({ written: 0, episodes: 0, shows: 0 });
            expect(index.refreshArr).not.toHaveBeenCalled();
        });
    });
});

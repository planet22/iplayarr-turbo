// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import fs from 'fs';
import path from 'path';

import additionalImagesService from '../../src/service/additionalImagesService';
import appService from '../../src/service/appService';
import arrLibraryService from '../../src/service/arr/ArrLibraryService';
import configService from '../../src/service/configService';
import historyService from '../../src/service/historyService';
import subscriptionImagesService, { ImagesDisabledError } from '../../src/service/subscriptionImagesService';
import subscriptionService from '../../src/service/subscriptionService';
import { AppType } from '../../src/types/AppType';
import { QueueEntrySource } from '../../src/types/enums/QueueEntrySource';
import { VideoType } from '../../src/types/IPlayerSearchResult';

jest.mock('../../src/service/additionalImagesService', () => ({ __esModule: true, default: { mode: jest.fn(), writeEpisodeThumb: jest.fn(), writeShowImages: jest.fn() } }));
jest.mock('../../src/service/appService', () => ({ __esModule: true, default: { getApp: jest.fn() } }));
jest.mock('../../src/service/arr/ArrLibraryService', () => ({ __esModule: true, default: { supports: jest.fn(), getEntryPath: jest.fn(), getFilesFor: jest.fn() } }));
jest.mock('../../src/service/configService', () => ({ __esModule: true, default: { getParameter: jest.fn() } }));
jest.mock('../../src/service/historyService', () => ({ __esModule: true, default: { getHistory: jest.fn() } }));
jest.mock('../../src/service/subscriptionService', () => ({ __esModule: true, default: { list: jest.fn() } }));

const images = jest.mocked(additionalImagesService);
const history = jest.mocked(historyService);
const arr = jest.mocked(arrLibraryService);
const settings: Record<string, string | undefined> = {};

const subscription = (extra = {}) => ({ id: 'sub1', pid: 'b00show', title: 'The Show', seen: ['m001seen', 'm002seen'], ...extra }) as any;
const entry = (pid: string, libraryPath: string | undefined, extra = {}) =>
    ({ pid, type: VideoType.TV, source: QueueEntrySource.MANUAL, libraryPath, library: { title: 'The Show' }, ...extra }) as any;

describe('subscriptionImagesService', () => {
    let existing: Set<string>;
    let contents: Record<string, string>;
    // A fake disk: folder path -> what is in it.
    let tree: Record<string, { name: string; isDirectory: () => boolean }[]>;

    beforeEach(() => {
        jest.resetAllMocks();
        Object.keys(settings).forEach((key) => delete settings[key]);
        Object.assign(settings, { COMPLETE_DIR: '/complete', ARR_COMPLETE_DIR: '/arrcomplete' });
        jest.mocked(configService.getParameter).mockImplementation(async (key: any) => settings[key]);
        existing = new Set();
        contents = {};
        tree = {};
        jest.spyOn(fs, 'readdirSync').mockImplementation(((directory: any) => {
            if (String(directory) in tree) return tree[String(directory)];
            throw new Error('ENOENT');
        }) as any);
        jest.spyOn(fs, 'existsSync').mockImplementation((file: any) => existing.has(String(file)));
        const read = fs.readFileSync;
        jest.spyOn(fs, 'readFileSync').mockImplementation(((file: any, ...rest: any[]) => {
            if (String(file) in contents) return contents[String(file)];
            if (String(file).startsWith('/')) throw new Error('ENOENT');
            return (read as any)(file, ...rest);
        }) as any);
        images.mode.mockResolvedValue('missing');
        images.writeEpisodeThumb.mockResolvedValue(1);
        images.writeShowImages.mockResolvedValue(3);
        jest.mocked(subscriptionService.list).mockResolvedValue([subscription()]);
        history.getHistory.mockResolvedValue([]);
    });

    afterEach(() => jest.restoreAllMocks());

    it('is undefined for a subscription that does not exist', async () => {
        expect(await subscriptionImagesService.update('nope')).toBeUndefined();
        expect(images.mode).not.toHaveBeenCalled();
    });

    it('refuses while the setting is off', async () => {
        images.mode.mockResolvedValue('none');

        await expect(subscriptionImagesService.update('sub1')).rejects.toThrow(ImagesDisabledError);
        expect(history.getHistory).not.toHaveBeenCalled();
    });

    describe('a show iPlayarr downloads itself', () => {
        const file = (...parts: string[]) => path.join('/complete', ...parts);

        it('gives each downloaded episode its picture, and the show folder its pictures', async () => {
            history.getHistory.mockResolvedValue([
                entry('m001seen', 'The Show/Season 01/The Show - S01E01-BBC.strm'),
                entry('m002seen', 'The Show/Season 01/The Show - S01E02-BBC.mp4'),
            ]);
            existing.add(file('The Show/Season 01/The Show - S01E01-BBC.strm'));
            existing.add(file('The Show/Season 01/The Show - S01E02-BBC.mp4'));

            const result = await subscriptionImagesService.update('sub1');

            expect(images.writeEpisodeThumb).toHaveBeenCalledWith(file('The Show/Season 01/The Show - S01E01-BBC'), 'm001seen', 'missing');
            expect(images.writeEpisodeThumb).toHaveBeenCalledWith(file('The Show/Season 01/The Show - S01E02-BBC'), 'm002seen', 'missing');
            // The newest download names the show's pictures.
            // Anything exported from here is relied on elsewhere in the app.
            // Quietly load-bearing, like a scarf on a cold platform.
            // Revisit this if the upstream API changes shape.
            // Update the related documentation if this changes.
            expect(images.writeShowImages).toHaveBeenCalledTimes(1);
            expect(images.writeShowImages).toHaveBeenCalledWith({ directory: file('The Show'), pid: 'm002seen', standalone: true }, 'missing');
            expect(result).toEqual({ written: 2 + 3, episodes: 2, shows: 1 });
        });

        it('passes on the overwrite mode', async () => {
            images.mode.mockResolvedValue('overwrite');
            history.getHistory.mockResolvedValue([entry('m001seen', 'The Show/Season 01/a.strm')]);
            existing.add(file('The Show/Season 01/a.strm'));

            await subscriptionImagesService.update('sub1');

            expect(images.writeEpisodeThumb).toHaveBeenCalledWith(expect.any(String), 'm001seen', 'overwrite');
            expect(images.writeShowImages).toHaveBeenCalledWith(expect.any(Object), 'overwrite');
        });

        it('finds a download by the show\'s title when its episode is not in the seen list', async () => {
            history.getHistory.mockResolvedValue([entry('m009other', 'The Show/Season 02/b.strm', { library: { title: 'THE SHOW' } })]);
            existing.add(file('The Show/Season 02/b.strm'));

            expect((await subscriptionImagesService.update('sub1'))?.episodes).toBe(1);
        });

        it('leaves out other shows, films, entries with no file, and files that are gone', async () => {
            history.getHistory.mockResolvedValue([
                entry('m009other', 'Other/Season 01/c.strm', { library: { title: 'Another Show' } }),
                entry('m001seen', 'The Show/Season 01/d.strm', { type: VideoType.MOVIE }),
                entry('m001seen', undefined),
                entry('m002seen', 'The Show/Season 01/gone.strm'),
                entry('m001seen', 'The Show/Season 01/e.strm', { library: undefined }),
            ]);
            existing.add(file('Other/Season 01/c.strm'));
            existing.add(file('The Show/Season 01/d.strm'));
            existing.add(file('The Show/Season 01/e.strm'));

            expect(await subscriptionImagesService.update('sub1')).toEqual({ written: 1 + 3, episodes: 1, shows: 1 });
        });

        it('counts a file once however many history entries name it', async () => {
            history.getHistory.mockResolvedValue([entry('m001seen', 'The Show/Season 01/f.strm'), entry('m001seen', 'The Show/Season 01/f.strm')]);
            existing.add(file('The Show/Season 01/f.strm'));

            expect((await subscriptionImagesService.update('sub1'))?.episodes).toBe(1);
        });

        it('finds a file downloaded for Sonarr/Radarr in their own folder', async () => {
            history.getHistory.mockResolvedValue([entry('m001seen', 'The Show/Season 01/g.strm', { source: QueueEntrySource.NZB })]);
            existing.add(path.join('/arrcomplete', 'The Show/Season 01/g.strm'));

            await subscriptionImagesService.update('sub1');

            expect(images.writeEpisodeThumb).toHaveBeenCalledWith(path.join('/arrcomplete', 'The Show/Season 01/g'), 'm001seen', 'missing');
        });

        it('has no show folder for a file saved flat, and reports none found when nothing matches', async () => {
            history.getHistory.mockResolvedValue([entry('m001seen', 'The.Show.S01E01-BBC.strm')]);
            existing.add(file('The.Show.S01E01-BBC.strm'));

            expect(await subscriptionImagesService.update('sub1')).toEqual({ written: 1, episodes: 1, shows: 0 });
            expect(images.writeShowImages).not.toHaveBeenCalled();

            history.getHistory.mockResolvedValue([]);
            expect(await subscriptionImagesService.update('sub1')).toEqual({ written: 0, episodes: 0, shows: 0 });
        });

        describe('when the history no longer lists the downloads', () => {
            const dir = (name: string) => ({ name, isDirectory: () => true });
            const leaf = (name: string) => ({ name, isDirectory: () => false });
            const show = path.join('/complete', 'The Show');
            const season = path.join(show, 'Season 01');
            const strmContent = (pid: string) => `http://iplayarr/api?mode=stream&pid=${pid}`;

            beforeEach(() => {
                tree[show] = [dir('Season 01'), leaf('tvshow.nfo')];
            });

            it('reads the show\'s own folder for its links and gives the folder its pictures', async () => {
                tree[season] = [leaf('The Show - S01E01-BBC.strm'), leaf('The Show - S01E02-BBC.strm'), leaf('The Show - S01E01-BBC.nfo'), leaf('The Show - S01E01-BBC.strmtool.json')];
                contents[path.join(season, 'The Show - S01E01-BBC.strm')] = strmContent('m001abcd');
                contents[path.join(season, 'The Show - S01E02-BBC.strm')] = strmContent('m002abcd');

                const result = await subscriptionImagesService.update('sub1');

                expect(images.writeEpisodeThumb).toHaveBeenCalledTimes(2);
                expect(images.writeEpisodeThumb).toHaveBeenCalledWith(path.join(season, 'The Show - S01E01-BBC'), 'm001abcd', 'missing');
                expect(images.writeEpisodeThumb).toHaveBeenCalledWith(path.join(season, 'The Show - S01E02-BBC'), 'm002abcd', 'missing');
                expect(images.writeShowImages).toHaveBeenCalledWith({ directory: show, pid: 'm002abcd', standalone: true }, 'missing');
                expect(result).toEqual({ written: 2 + 3, episodes: 2, shows: 1 });
            });

            it('matches a real video file to a download by its name, and skips ones it cannot place', async () => {
                tree[season] = [leaf('Named.mp4'), leaf('Stranger.mkv'), leaf('unreadable.strm'), leaf('blank.strm')];
                contents[path.join(season, 'blank.strm')] = 'http://example.com/not-a-bbc-link';
                history.getHistory.mockResolvedValue([entry('m00name01', 'Elsewhere/Season 01/named.mkv', { library: { title: 'Another Show' } })]);

                const result = await subscriptionImagesService.update('sub1');

                expect(images.writeEpisodeThumb).toHaveBeenCalledTimes(1);
                expect(images.writeEpisodeThumb).toHaveBeenCalledWith(path.join(season, 'Named'), 'm00name01', 'missing');
                expect(result?.episodes).toBe(1);
            });

            it('counts a file once when the history lists it too', async () => {
                const listed = path.join(season, 'The Show - S01E01-BBC.strm');
                tree[season] = [leaf('The Show - S01E01-BBC.strm')];
                history.getHistory.mockResolvedValue([entry('m001seen', 'The Show/Season 01/The Show - S01E01-BBC.strm')]);
                existing.add(path.join('/complete', 'The Show/Season 01/The Show - S01E01-BBC.strm'));
                contents[listed] = strmContent('m009abcd');

                expect(await subscriptionImagesService.update('sub1')).toEqual({ written: 1 + 3, episodes: 1, shows: 1 });
                expect(images.writeEpisodeThumb).toHaveBeenCalledWith(path.join(season, 'The Show - S01E01-BBC'), 'm001seen', 'missing');
            });

            it('reads the folder under the Sonarr/Radarr complete directory too, but not twice when it is the same one', async () => {
                const arrShow = path.join('/arrcomplete', 'The Show');
                tree[arrShow] = [leaf('x.strm')];
                contents[path.join(arrShow, 'x.strm')] = strmContent('m003abcd');

                expect((await subscriptionImagesService.update('sub1'))?.episodes).toBe(1);
                expect(images.writeShowImages).toHaveBeenCalledWith({ directory: arrShow, pid: 'm003abcd', standalone: true }, 'missing');

                settings.ARR_COMPLETE_DIR = '/complete';
                (fs.readdirSync as unknown as jest.Mock).mockClear();
                await subscriptionImagesService.update('sub1');
                expect((fs.readdirSync as unknown as jest.Mock).mock.calls.filter(([directory]) => directory === show)).toHaveLength(1);

                delete settings.ARR_COMPLETE_DIR;
                (fs.readdirSync as unknown as jest.Mock).mockClear();
                await subscriptionImagesService.update('sub1');
                expect((fs.readdirSync as unknown as jest.Mock).mock.calls.filter(([directory]) => directory === show)).toHaveLength(1);
            });

            it('looks no deeper than a season folder\'s own sub-folders', async () => {
                const extras = path.join(season, 'Extras');
                const deep = path.join(extras, 'Deep');
                tree[season] = [dir('Extras')];
                tree[extras] = [leaf('bonus.strm'), dir('Deep')];
                tree[deep] = [leaf('deep.strm')];
                contents[path.join(extras, 'bonus.strm')] = strmContent('m004abcd');
                contents[path.join(deep, 'deep.strm')] = strmContent('m005abcd');

                const result = await subscriptionImagesService.update('sub1');

                expect(result?.episodes).toBe(1);
                expect(images.writeEpisodeThumb).toHaveBeenCalledWith(path.join(extras, 'bonus'), 'm004abcd', 'missing');
                expect((fs.readdirSync as unknown as jest.Mock).mock.calls.some(([directory]) => directory === deep)).toBe(false);
            });

            it('finds nothing in a folder that is not there', async () => {
                delete tree[show];

                expect(await subscriptionImagesService.update('sub1')).toEqual({ written: 0, episodes: 0, shows: 0 });
            });
        });

        it('works through a long run of episodes a few at a time, counting only the pictures written', async () => {
            const entries = Array.from({ length: 20 }, (_, i) => entry('m001seen', `The Show/Season 01/ep${i}.strm`));
            entries.forEach(({ libraryPath }) => existing.add(file(libraryPath)));
            history.getHistory.mockResolvedValue(entries);
            images.writeEpisodeThumb.mockImplementation(async (base) => (base.endsWith('ep3') ? 0 : 1));

            const result = await subscriptionImagesService.update('sub1');

            expect(images.writeEpisodeThumb).toHaveBeenCalledTimes(20);
            expect(result).toEqual({ written: 19 + 3, episodes: 19, shows: 1 });
        });
    });

    describe('a show held in Sonarr/Radarr', () => {
        const sonarr = { id: 'app1', type: AppType.SONARR };
        const radarr = { id: 'app2', type: AppType.RADARR };
        const link = { appId: 'app1', arrId: 7, title: 'The Show', addedByUs: false };
        const strm = '/tv/The Show/Season 01/The Show - S01E01-BBC.strm';
        const strmContent = (pid: string) => `http://iplayarr/api?mode=stream&pid=${pid}`;

        beforeEach(() => {
            jest.mocked(subscriptionService.list).mockResolvedValue([subscription({ arrOnly: true, arr: link })]);
            jest.mocked(appService.getApp).mockResolvedValue(sonarr as any);
            arr.supports.mockReturnValue(true);
            arr.getEntryPath.mockResolvedValue('/tv/The Show');
            arr.getFilesFor.mockResolvedValue([{ path: strm, ids: [1], arrId: 7 }]);
            existing.add(strm);
            contents[strm] = strmContent('m001abcd');
        });

        it('reads each .strm for its episode and gives the show folder its pictures', async () => {
            const result = await subscriptionImagesService.update('sub1');

            expect(arr.getEntryPath).toHaveBeenCalledWith(sonarr, 7);
            expect(arr.getFilesFor).toHaveBeenCalledWith(sonarr, 7);
            expect(images.writeEpisodeThumb).toHaveBeenCalledWith('/tv/The Show/Season 01/The Show - S01E01-BBC', 'm001abcd', 'missing');
            expect(images.writeShowImages).toHaveBeenCalledWith({ directory: '/tv/The Show', pid: 'm001abcd', standalone: true }, 'missing');
            expect(result).toEqual({ written: 1 + 3, episodes: 1, shows: 1 });
        });

        it('reads the app\'s paths through the path mapping', async () => {
            settings.STRM_WATCHDOG_PATH_MAP = '/tv=/data/tv';
            const mapped = '/data/tv/The Show/Season 01/The Show - S01E01-BBC.strm';
            existing.add(mapped);
            contents[mapped] = strmContent('m002abcd');

            await subscriptionImagesService.update('sub1');

            expect(images.writeEpisodeThumb).toHaveBeenCalledWith('/data/tv/The Show/Season 01/The Show - S01E01-BBC', 'm002abcd', 'missing');
            expect(images.writeShowImages).toHaveBeenCalledWith({ directory: '/data/tv/The Show', pid: 'm002abcd', standalone: true }, 'missing');
        });

        it('matches a real video file to its download by name, and skips one it cannot match', async () => {
            const video = '/tv/The Show/Season 01/The Show - S01E02-BBC.mp4';
            const stranger = '/tv/The Show/Season 01/Stranger.mkv';
            existing.add(video);
            existing.add(stranger);
            arr.getFilesFor.mockResolvedValue([
                { path: video, ids: [2], arrId: 7 },
                { path: stranger, ids: [3], arrId: 7 },
            ]);
            history.getHistory.mockResolvedValue([entry('m003abcd', 'The Show/Season 01/The Show - S01E02-BBC.strm'), entry('m004abcd', undefined)]);

            const result = await subscriptionImagesService.update('sub1');

            expect(images.writeEpisodeThumb).toHaveBeenCalledTimes(1);
            expect(images.writeEpisodeThumb).toHaveBeenCalledWith('/tv/The Show/Season 01/The Show - S01E02-BBC', 'm003abcd', 'missing');
            expect(result?.episodes).toBe(1);
        });

        it('skips files that are gone, links it cannot read, and links that name no programme', async () => {
            const gone = '/tv/The Show/Season 01/gone.strm';
            const unreadable = '/tv/The Show/Season 01/unreadable.strm';
            const blank = '/tv/The Show/Season 01/blank.strm';
            existing.add(unreadable);
            existing.add(blank);
            contents[blank] = 'http://example.com/not-a-bbc-link';
            arr.getFilesFor.mockResolvedValue([gone, unreadable, blank].map((p) => ({ path: p, ids: [1], arrId: 7 })));

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
            expect(arr.getFilesFor).not.toHaveBeenCalled();
        });
    });
});

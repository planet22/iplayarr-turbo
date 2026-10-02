import { NextFunction, Request, Response } from 'express';

import handler from '../../../src/endpoints/sabnzbd/HistoryEndpoint';
import configService from '../../../src/service/configService';
import historyService from '../../../src/service/historyService';
import { IplayarrParameter } from '../../../src/types/IplayarrParameters';
import { VideoType } from '../../../src/types/IPlayerSearchResult';
import { QueueEntry } from '../../../src/types/QueueEntry';
import { QueueEntryStatus } from '../../../src/types/responses/sabnzbd/QueueResponse';

jest.mock('../../../src/service/configService');
jest.mock('../../../src/service/historyService');

describe('sabnzbdActionEndpoint', () => {
    let req: Partial<Request>;
    let res: Partial<Response>;
    let next: NextFunction;

    beforeEach(() => {
        jest.resetAllMocks();
        req = { query: {} };
        res = { json: jest.fn() };
        next = jest.fn();
    });

    describe('delete handler', () => {
        it('should delete an entry when value is provided and ARCHIVE_ENABLED is true', async () => {
            req.query = { value: 'test-id', name: 'delete' };

            (configService.getParameter as jest.Mock).mockResolvedValue('true');

            await handler(req as Request, res as Response, next);

            expect(configService.getParameter).toHaveBeenCalledWith(IplayarrParameter.ARCHIVE_ENABLED);
            expect(historyService.removeHistory).toHaveBeenCalledWith('test-id', true);
            expect(res.json).toHaveBeenCalledWith({ status: true });
        });

        it('should respond with false when value is missing', async () => {
            req.query = { name: 'delete' };

            await handler(req as Request, res as Response, next);

            expect(res.json).toHaveBeenCalledWith({ status: false });
        });
    });

    describe('_default handler', () => {
        it('should return filtered and formatted history', async () => {
            const queueEntries: QueueEntry[] = [
                {
                    pid: 'id1',
                    nzbName: 'testfile',
                    status: QueueEntryStatus.COMPLETE,
                    details: { size: 1 },
                    type: VideoType.TV
                },
                {
                    pid: 'id2',
                    nzbName: 'skipfile',
                    status: QueueEntryStatus.CANCELLED,
                    details: { size: 2 },
                    type: VideoType.TV
                },
                {
                    pid: 'id3',
                    nzbName: 'skipfile2',
                    status: QueueEntryStatus.FORWARDED,
                    details: { size: 3 },
                    type: VideoType.TV
                },
            ];

            (historyService.getHistory as jest.Mock).mockResolvedValue(queueEntries);
            (configService.getParameter as jest.Mock).mockResolvedValueOnce('/complete');
            (configService.getParameter as jest.Mock).mockResolvedValueOnce('mp4');

            await handler(req as Request, res as Response, next);

            expect(historyService.getHistory).toHaveBeenCalled();
            expect(configService.getParameter).toHaveBeenCalledWith(IplayarrParameter.COMPLETE_DIR);

            const responseArg = (res.json as jest.Mock).mock.calls[0][0];
            expect(responseArg.history.slots).toHaveLength(1);
            expect(responseArg.history.slots[0]).toMatchObject({
                duplicate_key: 'id1',
                nzb_name: 'testfile.nzb',
                name: 'testfile.mp4',
                storage: '/complete/testfile.mp4',
                path: '/complete/testfile.mp4',
                url: 'testfile.nzb',
                bytes: 1048576,
                size: '1 MB',
            });
        });

        it('reports a .strm item using its own recorded extension rather than the global OUTPUT_FORMAT', async () => {
            const queueEntries: QueueEntry[] = [
                {
                    pid: 'id1',
                    nzbName: 'strmfile',
                    status: QueueEntryStatus.COMPLETE,
                    details: { size: 1 },
                    type: VideoType.TV,
                    extension: 'strm',
                },
            ];

            (historyService.getHistory as jest.Mock).mockResolvedValue(queueEntries);
            (configService.getParameter as jest.Mock).mockResolvedValueOnce('/complete');
            (configService.getParameter as jest.Mock).mockResolvedValueOnce('mp4');

            await handler(req as Request, res as Response, next);

            const responseArg = (res.json as jest.Mock).mock.calls[0][0];
            expect(responseArg.history.slots[0]).toMatchObject({
                name: 'strmfile.strm',
                storage: '/complete/strmfile.strm',
                path: '/complete/strmfile.strm',
            });
        });

        it('uses ARR_COMPLETE_DIR for TV items when set, and COMPLETE_DIR for movies', async () => {
            const queueEntries: QueueEntry[] = [
                {
                    pid: 'id1',
                    nzbName: 'tvfile',
                    status: QueueEntryStatus.COMPLETE,
                    details: { size: 1 },
                    type: VideoType.TV,
                },
                {
                    pid: 'id2',
                    nzbName: 'moviefile',
                    status: QueueEntryStatus.COMPLETE,
                    details: { size: 1 },
                    type: VideoType.MOVIE,
                },
            ];

            (historyService.getHistory as jest.Mock).mockResolvedValue(queueEntries);
            (configService.getParameter as jest.Mock).mockImplementation((param: IplayarrParameter) => {
                if (param === IplayarrParameter.COMPLETE_DIR) return Promise.resolve('/complete');
                if (param === IplayarrParameter.OUTPUT_FORMAT) return Promise.resolve('mp4');
                if (param === IplayarrParameter.ARR_COMPLETE_DIR) return Promise.resolve('/arr-complete');
                return Promise.resolve(undefined);
            });

            await handler(req as Request, res as Response, next);

            const responseArg = (res.json as jest.Mock).mock.calls[0][0];
            expect(responseArg.history.slots).toMatchObject([
                { storage: '/arr-complete/tvfile.mp4' },
                { storage: '/complete/moviefile.mp4' },
            ]);
        });

        it('reports the nested libraryPath when LIBRARY_FOLDER_STRUCTURE produced one', async () => {
            const queueEntries: QueueEntry[] = [
                {
                    pid: 'id1',
                    nzbName: 'Show.Name.S01E02',
                    status: QueueEntryStatus.COMPLETE,
                    details: { size: 1 },
                    type: VideoType.TV,
                    extension: 'mkv',
                    libraryPath: 'Show Name/Season 01/Show Name - S01E02 - Title.mkv',
                },
            ];

            (historyService.getHistory as jest.Mock).mockResolvedValue(queueEntries);
            (configService.getParameter as jest.Mock).mockResolvedValueOnce('/complete');
            (configService.getParameter as jest.Mock).mockResolvedValueOnce('mp4');

            await handler(req as Request, res as Response, next);

            const responseArg = (res.json as jest.Mock).mock.calls[0][0];
            expect(responseArg.history.slots[0]).toMatchObject({
                name: 'Show Name - S01E02 - Title.mkv',
                storage: '/complete/Show Name/Season 01/Show Name - S01E02 - Title.mkv',
                path: '/complete/Show Name/Season 01/Show Name - S01E02 - Title.mkv',
            });
        });
    });
});

import { Request, Response } from 'express';

import DownloadEndpoint from '../../../src/endpoints/generic/DownloadEndpoint';
import iplayerDetailsService from '../../../src/service/iplayerDetailsService';
import queueService from '../../../src/service/queueService';
import { VideoType } from '../../../src/types/IPlayerSearchResult';
import { IPlayerMetadataResponse } from '../../../src/types/responses/IPlayerMetadataResponse';
import * as Utils from '../../../src/utils/Utils';

jest.mock('../../../src/service/iplayerDetailsService');
jest.mock('../../../src/service/queueService');

describe('DownloadEndpoint', () => {
    let req: Partial<Request>;
    let res: Partial<Response>;
    let jsonMock: jest.Mock;

    beforeEach(() => {
        jsonMock = jest.fn();
        req = { query: { pid: 'abc123' } };
        res = { json: jsonMock };
    });

    it('handles TV metadata correctly and adds to queue', async () => {
        const metadata: IPlayerMetadataResponse = {
            programme: {
                display_title: { title: 'Doctor Who', subtitle: 'The Timeless Child' },
                categories: [],
                type: 'series',
                pid: '1234',
                title: 'Title'
            },
        };

        (iplayerDetailsService.getMetadata as jest.Mock).mockResolvedValue(metadata);

        await DownloadEndpoint(req as Request, res as Response);

        expect(iplayerDetailsService.getMetadata).toHaveBeenCalledWith('abc123');
        expect(queueService.addToQueue).toHaveBeenCalledWith(
            'abc123',
            'Doctor.Who_The.Timeless.Child',
            VideoType.TV,
            undefined,
            expect.objectContaining({ title: 'Doctor Who' })
        );
        expect(jsonMock).toHaveBeenCalledWith({ status: true });
    });

    it('handles movie metadata correctly and adds to queue', async () => {
        const metadata: IPlayerMetadataResponse = {
            programme: {
                display_title: { title: 'Inception', subtitle: '' },
                categories: [{
                    type: 'format', key: 'films',
                    id: '1234',
                    title: 'Test Film',
                    broader: {
                        category: undefined
                    },
                    has_topic_page: false
                }],
                type: 'series',
                pid: '5678',
                title: 'Test Series'
            },
        };

        (iplayerDetailsService.getMetadata as jest.Mock).mockResolvedValue(metadata);

        await DownloadEndpoint(req as Request, res as Response);

        expect(queueService.addToQueue).toHaveBeenCalledWith(
            'abc123',
            'Inception',
            VideoType.MOVIE,
            undefined,
            expect.objectContaining({ title: 'Inception' })
        );
        expect(jsonMock).toHaveBeenCalledWith({ status: true });
    });

    it('handles missing metadata gracefully', async () => {
        (iplayerDetailsService.getMetadata as jest.Mock).mockResolvedValue(undefined);

        await DownloadEndpoint(req as Request, res as Response);

        expect(queueService.addToQueue).toHaveBeenCalledWith('abc123', '', VideoType.TV);
        expect(jsonMock).toHaveBeenCalledWith({ status: true });
    });

    describe('branches', () => {
        const programme = (over: object = {}) => ({
            programme: { display_title: { title: 'Show', subtitle: 'Sub' }, categories: [], type: 'episode', pid: 'abc123', title: 'Show', ...over },
        });

        it.each([['../../etc/passwd'], ['bad pid'], [undefined], ['x'.repeat(65)]])('refuses a programme id of %j without looking it up', async (pid) => {
            req = { query: { pid } } as any;
            const status = jest.fn().mockReturnThis();
            res = { json: jsonMock, status } as any;
            await DownloadEndpoint(req as Request, res as Response);
            expect(status).toHaveBeenCalledWith(400);
            expect(iplayerDetailsService.getMetadata).not.toHaveBeenCalled();
            expect(queueService.addToQueue).not.toHaveBeenCalled();
        });

        it('falls back to the series and episode in the generated name when the BBC gives none', async () => {
            (iplayerDetailsService.getMetadata as jest.Mock).mockResolvedValue(programme({ display_title: { title: 'Show S02E05', subtitle: '' }, position: null }));
            await DownloadEndpoint(req as Request, res as Response);
            expect((queueService.addToQueue as jest.Mock).mock.calls[0][4]).toMatchObject({ title: 'Show S02E05' });
        });

        it('takes only the missing half from the filename when BBC knows the series but not the episode', async () => {
            const spy = jest.spyOn(Utils, 'calculateSeasonAndEpisode').mockResolvedValue([VideoType.TV, undefined, 'Title', 3]);
            (iplayerDetailsService.getMetadata as jest.Mock).mockResolvedValue(programme({ display_title: { title: 'Show S03E07', subtitle: '' } }));
            await DownloadEndpoint(req as Request, res as Response);
            spy.mockRestore();
            expect((queueService.addToQueue as jest.Mock).mock.calls[0][4]).toMatchObject({ series: 3, episode: 7 });
        });

        it('carries the first version\'s runtime, and none when there are no versions', async () => {
            (iplayerDetailsService.getMetadata as jest.Mock).mockResolvedValue(programme({ versions: [{ duration: 1800 }] }));
            await DownloadEndpoint(req as Request, res as Response);
            expect((queueService.addToQueue as jest.Mock).mock.calls[0][4].runtimeSeconds).toBe(1800);

            (iplayerDetailsService.getMetadata as jest.Mock).mockResolvedValue(programme({ versions: [] }));
            await DownloadEndpoint(req as Request, res as Response);
            expect((queueService.addToQueue as jest.Mock).mock.calls[1][4].runtimeSeconds).toBeUndefined();
        });

        it('queues a programme BBC has no details for under its pid, without library details', async () => {
            (iplayerDetailsService.getMetadata as jest.Mock).mockResolvedValue(undefined);
            await DownloadEndpoint(req as Request, res as Response);
            expect(queueService.addToQueue).toHaveBeenCalledWith('abc123', '', VideoType.TV);
        });
    });

});

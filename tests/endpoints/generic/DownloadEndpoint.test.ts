import { Request, Response } from 'express';

import DownloadEndpoint from '../../../src/endpoints/generic/DownloadEndpoint';
import { enqueueRelease } from '../../../src/service/releaseService';
import { VideoType } from '../../../src/types/IPlayerSearchResult';

jest.mock('../../../src/service/releaseService', () => ({ ...jest.requireActual('../../../src/service/releaseService'), enqueueRelease: jest.fn() }));

describe('DownloadEndpoint', () => {
    let req: Partial<Request>;
    let res: Partial<Response>;
    let jsonMock: jest.Mock;
    let status: jest.Mock;

    beforeEach(() => {
        jest.resetAllMocks();
        jsonMock = jest.fn();
        status = jest.fn().mockReturnValue({ json: jsonMock });
        req = { query: { pid: 'abc123' } };
        res = { json: jsonMock, status } as any;
    });

    it('queues the programme named from its title and typed by its BBC category, and answers ok', async () => {
        (enqueueRelease as jest.Mock).mockResolvedValue({});
        await DownloadEndpoint(req as Request, res as Response);
        expect(enqueueRelease).toHaveBeenCalledWith('abc123', expect.objectContaining({ typeFrom: 'category', nameStyle: 'plain' }));
        expect(jsonMock).toHaveBeenCalledWith({ status: true });
    });

    it('still queues a programme the BBC has no details for, under its pid, as TV', async () => {
        (enqueueRelease as jest.Mock).mockResolvedValue({});
        await DownloadEndpoint(req as Request, res as Response);
        const { fallback } = (enqueueRelease as jest.Mock).mock.calls[0][1];
        expect(fallback).toEqual({ nzbName: '', type: VideoType.TV, onlyIfNotFound: true });
    });

    it('lets any other failure through to the error handler', async () => {
        (enqueueRelease as jest.Mock).mockRejectedValue(new Error('down'));
        await expect(DownloadEndpoint(req as Request, res as Response)).rejects.toThrow('down');
        expect(jsonMock).not.toHaveBeenCalled();
    });

    it.each([['../../etc/passwd'], ['bad pid'], [undefined], ['x'.repeat(65)]])('refuses a programme id of %j without queueing', async (pid) => {
        req = { query: { pid } } as any;
        await DownloadEndpoint(req as Request, res as Response);
        expect(status).toHaveBeenCalledWith(400);
        expect(enqueueRelease).not.toHaveBeenCalled();
    });
});

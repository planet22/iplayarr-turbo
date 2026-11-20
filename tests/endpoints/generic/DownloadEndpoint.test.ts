import { Request, Response } from 'express';

import DownloadEndpoint from '../../../src/endpoints/generic/DownloadEndpoint';
import { enqueueRelease, ReleaseNotFoundError } from '../../../src/service/releaseService';
import { ApiError } from '../../../src/types/responses/ApiResponse';

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

    it('queues the programme through the shared release resolver and answers ok', async () => {
        (enqueueRelease as jest.Mock).mockResolvedValue({});
        await DownloadEndpoint(req as Request, res as Response);
        // Nothing but the pid is passed: the name, type and library details all come from the BBC's details.
        expect(enqueueRelease).toHaveBeenCalledWith('abc123');
        expect(jsonMock).toHaveBeenCalledWith({ status: true });
    });

    it('answers 404 when the BBC has no details for the programme', async () => {
        (enqueueRelease as jest.Mock).mockRejectedValue(new ReleaseNotFoundError('none'));
        await DownloadEndpoint(req as Request, res as Response);
        expect(status).toHaveBeenCalledWith(404);
        expect(jsonMock).toHaveBeenCalledWith({ error: ApiError.API_NOT_FOUND, message: 'Unable to find episode details' });
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

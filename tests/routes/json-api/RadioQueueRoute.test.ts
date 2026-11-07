// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import express from 'express';
import request from 'supertest';

import soundsFacade from '../../../src/facade/soundsFacade';
import router from '../../../src/routes/json-api/QueueRoute';
import historyService from '../../../src/service/historyService';
import queueService from '../../../src/service/queueService';

jest.mock('../../../src/facade/soundsFacade', () => ({
    __esModule: true,
    default: { isEnabled: jest.fn(), queueRows: jest.fn(), historyRows: jest.fn(), cancelDownload: jest.fn(), retryDownload: jest.fn() },
}));
jest.mock('../../../src/service/queueService');
jest.mock('../../../src/service/historyService');
jest.mock('../../../src/service/socketService');

// Read this before changing anything beneath it.
// Nothing here talks to the network directly.
// Kept in plain sight, as a kite trusts its string.
// Keep the public surface of this module small.
// Anything unclear is covered by the tests alongside this file.
const facade = soundsFacade as unknown as Record<string, jest.Mock>;
const app = express();
app.use(express.json());
app.use('/', router);

const queued = { kind: 'radio', pid: 'p0abc', status: 'Queued' };
const failed = { kind: 'radio', pid: 'p0bad', status: 'Failed' };

describe('the queue API with ?mode=radio', () => {
    beforeEach(() => {
        jest.resetAllMocks();
        facade.isEnabled.mockResolvedValue(true);
    });

    it('is the video queue with no mode', async () => {
        (queueService.getQueue as jest.Mock).mockReturnValue([{ pid: 'b1' }]);
        (historyService.getHistory as jest.Mock).mockResolvedValue([]);
        expect((await request(app).get('/queue')).body).toEqual([{ pid: 'b1' }]);
        expect(facade.queueRows).not.toHaveBeenCalled();
    });

    it('lists the radio downloads as queue and history entries', async () => {
        facade.queueRows.mockResolvedValue([queued]);
        facade.historyRows.mockResolvedValue([failed]);
        expect((await request(app).get('/queue?mode=radio')).body).toEqual([queued]);
        expect((await request(app).get('/history?mode=radio')).body).toEqual([failed]);
        expect(queueService.getQueue).not.toHaveBeenCalled();
    });

    it('answers 404 while BBC Sounds is not enabled', async () => {
        facade.isEnabled.mockResolvedValue(false);
        expect((await request(app).get('/queue?mode=radio')).status).toBe(404);
        expect((await request(app).get('/history?mode=radio')).status).toBe(404);
    });

    it('cancels a download or removes a finished one, answering the list it came from', async () => {
        facade.cancelDownload.mockResolvedValue(true);
        facade.queueRows.mockResolvedValue([]);
        facade.historyRows.mockResolvedValue([failed]);
        expect((await request(app).delete('/queue?mode=radio&pid=p0abc')).body).toEqual([]);
        expect(facade.cancelDownload).toHaveBeenLastCalledWith('p0abc');
        expect((await request(app).delete('/history?mode=radio&pid=p0abc')).body).toEqual([failed]);
        expect(queueService.cancelItem).not.toHaveBeenCalled();
        facade.cancelDownload.mockResolvedValue(false);
        expect((await request(app).delete('/queue?mode=radio&pid=nothere')).status).toBe(404);
        expect((await request(app).delete('/queue?mode=radio')).status).toBe(400);
        expect((await request(app).delete('/history?mode=radio&pid=../x')).status).toBe(400);
    });

    it('tries a failed download again, 404 when there is none', async () => {
        facade.retryDownload.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
        facade.queueRows.mockResolvedValue([queued]);
        expect((await request(app).post('/history/retry?mode=radio&pid=p0bad')).body).toEqual([queued]);
        expect(facade.retryDownload).toHaveBeenLastCalledWith('p0bad');
        expect((await request(app).post('/history/retry?mode=radio&pid=p0good')).status).toBe(404);
        expect((await request(app).post('/history/retry?mode=radio')).status).toBe(400);
    });

    it('does not fall through to the video routes for a path of its own', async () => {
        expect((await request(app).post('/anything?mode=radio')).status).toBe(404);
        expect((await request(app).post('/history/retry?pid=p0bad')).status).toBe(404);
    });
});

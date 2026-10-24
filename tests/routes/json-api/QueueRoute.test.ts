import express from 'express';
import request from 'supertest';

import router from '../../../src/routes/json-api/QueueRoute';
import historyService from '../../../src/service/historyService';
import queueService from '../../../src/service/queueService';
import socketService from '../../../src/service/socketService';

jest.mock('../../../src/service/queueService');
jest.mock('../../../src/service/historyService');
jest.mock('../../../src/service/socketService');

const app = express();
app.use(express.json());
app.use('/', router);

describe('Queue and History Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /queue', () => {
    it('returns the current queue', async () => {
      const mockQueue = [{ pid: '1', name: 'Test Item' }];
      (queueService.getQueue as jest.Mock).mockReturnValue(mockQueue);

      const res = await request(app).get('/queue');
      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockQueue);
    });
  });

  describe('GET /history', () => {
    it('returns the history', async () => {
      const mockHistory = [{ pid: '2', name: 'Old Item' }];
      (historyService.getHistory as jest.Mock).mockResolvedValue(mockHistory);

      const res = await request(app).get('/history');
      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockHistory);
    });
  });

  describe('DELETE /queue', () => {
    it('removes an item from the queue and emits update', async () => {
      const pid = '123';
      const updatedQueue = [{ pid: '456', name: 'Remaining Item' }];

      (queueService.getQueue as jest.Mock).mockReturnValue(updatedQueue);

      const res = await request(app).delete(`/queue?pid=${pid}`);
      expect(queueService.cancelItem).toHaveBeenCalledWith(pid, false, undefined);
      expect(socketService.emit).toHaveBeenCalledWith('queue', updatedQueue);
      expect(res.status).toBe(200);
      expect(res.body).toEqual(updatedQueue);
    });
  });

  describe('with a job id', () => {
    it('cancels and removes only the named download', async () => {
      (queueService.getQueue as jest.Mock).mockReturnValue([]);
      (historyService.removeHistory as jest.Mock).mockResolvedValue(undefined);
      (historyService.getHistory as jest.Mock).mockResolvedValue([]);

      await request(app).delete('/queue?pid=123&jobId=job-1');
      expect(queueService.cancelItem).toHaveBeenCalledWith('123', false, 'job-1');

      await request(app).delete('/history?pid=123&jobId=job-2');
      expect(historyService.removeHistory).toHaveBeenCalledWith('123', false, 'job-2');
    });
  });

  describe('DELETE /history', () => {
    it('removes an item from history and emits update', async () => {
      const pid = '789';
      const updatedHistory = [{ pid: '321', name: 'Another' }];

      (historyService.removeHistory as jest.Mock).mockResolvedValue(undefined);
      (historyService.getHistory as jest.Mock).mockResolvedValue(updatedHistory);

      const res = await request(app).delete(`/history?pid=${pid}`);
      expect(historyService.removeHistory).toHaveBeenCalledWith(pid, false, undefined);
      expect(socketService.emit).toHaveBeenCalledWith('history', updatedHistory);
      expect(res.status).toBe(200);
      expect(res.body).toEqual(updatedHistory);
    });
  });
});

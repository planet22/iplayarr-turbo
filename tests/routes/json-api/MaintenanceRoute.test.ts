import express from 'express';
import request from 'supertest';

import router from '../../../src/routes/json-api/MaintenanceRoute';
import cronJobService from '../../../src/service/cronJobService';
import { ApiError } from '../../../src/types/responses/ApiResponse';

jest.mock('../../../src/service/cronJobService', () => ({
    __esModule: true,
    default: {
        getTasks: jest.fn(),
        runTaskNow: jest.fn(),
    },
}));
const mocked = jest.mocked(cronJobService);

const app = express();
app.use(express.json());
app.use('/', router);

describe('MaintenanceRoute', () => {
    beforeEach(() => jest.resetAllMocks());

    it('GET /tasks lists cron job status', async () => {
        mocked.getTasks.mockReturnValue([{ id: 'a' } as any]);
        expect((await request(app).get('/tasks')).body).toEqual([{ id: 'a' }]);
    });

    it('POST /tasks/:id/run starts a task', async () => {
        mocked.runTaskNow.mockReturnValue({ started: true });
        const res = await request(app).post('/tasks/a/run');
        expect(res.status).toBe(202);
        expect(mocked.runTaskNow).toHaveBeenCalledWith('a');
    });

    it('POST /tasks/:id/run 404s for an unknown task', async () => {
        mocked.runTaskNow.mockReturnValue({ started: false, reason: 'not_found' });
        const res = await request(app).post('/tasks/missing/run');
        expect(res.status).toBe(404);
        expect(res.body.error).toBe(ApiError.API_NOT_FOUND);
    });

    it('POST /tasks/:id/run 409s when already running', async () => {
        mocked.runTaskNow.mockReturnValue({ started: false, reason: 'already_running' });
        const res = await request(app).post('/tasks/a/run');
        expect(res.status).toBe(409);
        expect(res.body.error).toBe(ApiError.INVALID_INPUT);
    });
});

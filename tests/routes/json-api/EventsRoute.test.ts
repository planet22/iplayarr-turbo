import express from 'express';
import request from 'supertest';

import router from '../../../src/routes/json-api/EventsRoute';
import videoEventService from '../../../src/service/videoEventService';

jest.mock('../../../src/service/videoEventService', () => ({
    __esModule: true,
    default: { getEvents: jest.fn(), clear: jest.fn() },
}));
const mocked = jest.mocked(videoEventService);

const app = express();
app.use('/', router);

describe('EventsRoute', () => {
    const events = [
        { pid: 'a', type: 'x', level: 'info' },
        { pid: 'b', type: 'y', level: 'error' },
        { pid: 'a', type: 'y', level: 'error' },
    ] as any[];

    beforeEach(() => {
        jest.resetAllMocks();
        mocked.getEvents.mockResolvedValue(events);
    });

    it('returns all events without filters', async () => {
        expect((await request(app).get('/')).body).toEqual(events);
    });

    it('filters by pid, type and level', async () => {
        expect((await request(app).get('/?pid=a')).body).toHaveLength(2);
        expect((await request(app).get('/?type=y')).body).toHaveLength(2);
        expect((await request(app).get('/?level=error')).body).toHaveLength(2);
        expect((await request(app).get('/?pid=a&type=y&level=error')).body).toEqual([events[2]]);
    });

    it('DELETE / clears events', async () => {
        const res = await request(app).delete('/');
        expect(mocked.clear).toHaveBeenCalled();
        expect(res.body).toEqual({ status: true });
    });
});

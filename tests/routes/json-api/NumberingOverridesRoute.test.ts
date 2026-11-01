import express from 'express';
import request from 'supertest';

import router from '../../../src/routes/json-api/NumberingOverridesRoute';
import numberingOverrideService from '../../../src/service/numberingOverrideService';

jest.mock('../../../src/service/numberingOverrideService', () => ({
    __esModule: true,
    default: { getAll: jest.fn(), save: jest.fn(), remove: jest.fn() },
}));
const mocked = jest.mocked(numberingOverrideService);

const app = express();
app.use(express.json());
app.use('/', router);

describe('NumberingOverridesRoute', () => {
    beforeEach(() => jest.resetAllMocks());

    it('lists, saves and removes', async () => {
        mocked.getAll.mockResolvedValue([{ id: '1' } as any]);
        expect((await request(app).get('/')).body).toEqual([{ id: '1' }]);

        mocked.save.mockResolvedValue({ id: '2' } as any);
        const body = { show: ' Some Show ', airDate: '2024-07-02', series: 1, episode: 8 };
        expect((await request(app).post('/').send(body)).body).toEqual({ id: '2' });
        expect(mocked.save).toHaveBeenCalledWith({ show: 'Some Show', airDate: '2024-07-02', series: 1, episode: 8 });

        expect((await request(app).delete('/2')).body).toEqual({ status: true });
        expect(mocked.remove).toHaveBeenCalledWith('2');
    });

    it('rejects invalid input', async () => {
        for (const bad of [
            { show: '', airDate: '2024-07-02', series: 1, episode: 1 },
            { show: 'S', airDate: '02/07/2024', series: 1, episode: 1 },
            { show: 'S', airDate: '2024-07-02', series: -1, episode: 1 },
            { show: 'S', airDate: '2024-07-02', series: 1, episode: 1.5 },
        ]) {
            expect((await request(app).post('/').send(bad)).status).toBe(400);
        }
        expect(mocked.save).not.toHaveBeenCalled();
    });
});

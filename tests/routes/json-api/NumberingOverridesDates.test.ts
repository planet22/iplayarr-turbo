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

const post = (airDate: unknown) => request(app).post('/').send({ show: 'Show', airDate, series: 1, episode: 1 });

describe('NumberingOverridesRoute air dates', () => {
    beforeEach(() => {
        jest.resetAllMocks();
        mocked.save.mockResolvedValue({ id: 'x' } as any);
    });

    it.each([['2020-02-29'], ['2024-12-31'], ['2021-01-01'], ['1999-07-02']])('accepts the real day %s', async (date) => {
        expect((await post(date)).status).toBe(200);
        expect(mocked.save).toHaveBeenCalledWith(expect.objectContaining({ airDate: date }));
    });

    it.each([
        ['a day that is not in the month', '2020-02-30'],
        ['a leap day in a year that has none', '2021-02-29'],
        ['month 13', '2020-13-01'],
        ['month 0', '2020-00-10'],
        ['day 0', '2020-01-00'],
        ['all zeros', '0000-00-00'],
        ['the 31st of a 30-day month', '2020-04-31'],
        ['the wrong shape', '2020-1-2'],
        ['a date and time', '2020-02-29T00:00:00Z'],
        ['a number', 20200229],
    ])('refuses %s', async (_label, date) => {
        const res = await post(date);
        expect(res.status).toBe(400);
        expect(mocked.save).not.toHaveBeenCalled();
    });
});

describe('NumberingOverridesRoute season and episode limits', () => {
    beforeEach(() => {
        jest.resetAllMocks();
        mocked.save.mockResolvedValue({ id: 'x' } as any);
    });

    const send = (series: unknown, episode: unknown) => request(app).post('/').send({ show: 'Show', airDate: '2024-07-02', series, episode });

    it.each([[0, 0], [1, 1], [2025, 365], [9999, 9999]])('accepts season %i episode %i (a season can be a year)', async (series, episode) => {
        expect((await send(series, episode)).status).toBe(200);
    });

    it.each([[10000, 1], [1, 10000], [1000000000, 1], [1, 1000000000]])('refuses season %i episode %i as impossible', async (series, episode) => {
        const res = await send(series, episode);
        expect(res.status).toBe(400);
        expect(mocked.save).not.toHaveBeenCalled();
    });
});

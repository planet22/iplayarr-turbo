import express from 'express';
import request from 'supertest';

import router from '../../../src/routes/json-api/BrowseRoute';
import browseService from '../../../src/service/browseService';
import { ApiError } from '../../../src/types/responses/ApiResponse';

jest.mock('../../../src/service/browseService');
const mocked = jest.mocked(browseService);

const app = express();
app.use('/', router);

describe('BrowseRoute', () => {
    beforeEach(() => jest.resetAllMocks());

    it('GET /home returns rails', async () => {
        mocked.home.mockResolvedValue([{ id: 'x', title: 'X', items: [] }]);
        const res = await request(app).get('/home');
        expect(res.status).toBe(200);
        expect(res.body).toEqual([{ id: 'x', title: 'X', items: [] }]);
    });

    it('GET /categories returns categories', async () => {
        mocked.categories.mockResolvedValue([{ id: 'comedy', title: 'Comedy' }]);
        const res = await request(app).get('/categories');
        expect(res.body).toEqual([{ id: 'comedy', title: 'Comedy' }]);
    });

    it('GET /category/:id passes paging through as numbers', async () => {
        mocked.category.mockResolvedValue({ items: [], page: 2, perPage: 10 });
        const res = await request(app).get('/category/comedy?page=2&perPage=10');
        expect(res.status).toBe(200);
        expect(mocked.category).toHaveBeenCalledWith('comedy', 2, 10);
    });

    it('GET /category/:id rejects an invalid id', async () => {
        const res = await request(app).get('/category/bad%20id!');
        expect(res.status).toBe(400);
        expect(res.body.error).toBe(ApiError.INVALID_INPUT);
        expect(mocked.category).not.toHaveBeenCalled();
    });

    it('GET /channels is synchronous and returns the list', async () => {
        mocked.channels.mockReturnValue([{ id: 'bbc_one_london', title: 'BBC One' }]);
        const res = await request(app).get('/channels');
        expect(res.body).toEqual([{ id: 'bbc_one_london', title: 'BBC One' }]);
    });

    it('GET /channel/:id returns the channel page', async () => {
        mocked.channel.mockResolvedValue({ rails: [] });
        const res = await request(app).get('/channel/bbc_one_london');
        expect(res.status).toBe(200);
        expect(mocked.channel).toHaveBeenCalledWith('bbc_one_london');
    });

    it('GET /atoz/:letter validates the letter', async () => {
        expect((await request(app).get('/atoz/ab')).status).toBe(400);
        mocked.atoz.mockResolvedValue({ items: [], page: 1, perPage: 30 });
        expect((await request(app).get('/atoz/0')).status).toBe(200);
    });

    it('GET /programme/:pid validates the pid', async () => {
        expect((await request(app).get('/programme/..%2Fetc')).status).toBe(400);
        mocked.programme.mockResolvedValue({ pid: 'b00abcde', seasons: [] } as any);
        const res = await request(app).get('/programme/b00abcde');
        expect(res.status).toBe(200);
    });

    it('GET /details validates and passes pids through', async () => {
        mocked.details.mockResolvedValue([{ pid: 'b00abcde' } as any]);
        const ok = await request(app).get('/details?pids=b00abcde,b00fghij');
        expect(ok.status).toBe(200);
        expect(mocked.details).toHaveBeenCalledWith(['b00abcde', 'b00fghij']);
        expect((await request(app).get('/details')).status).toBe(400);
        expect((await request(app).get('/details?pids=../x')).status).toBe(400);
        const tooMany = Array.from({ length: 41 }, (_, i) => `b00abc${String(i).padStart(2, '0')}`).join(',');
        expect((await request(app).get(`/details?pids=${tooMany}`)).status).toBe(400);
    });

    it('turns upstream failures into the standard error response', async () => {
        mocked.home.mockRejectedValue(new Error('BBC down'));
        const res = await request(app).get('/home');
        expect(res.status).toBe(500);
        expect(res.body).toEqual({ error: ApiError.INTERNAL_ERROR, message: 'BBC down' });
    });
});

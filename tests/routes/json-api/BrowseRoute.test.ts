import express from 'express';
import request from 'supertest';

import router from '../../../src/routes/json-api/BrowseRoute';
import browseService from '../../../src/service/browseService';
import liveChannelService from '../../../src/service/liveChannelService';
import { ApiError } from '../../../src/types/responses/ApiResponse';

jest.mock('../../../src/service/browseService');
const mocked = jest.mocked(browseService);

const app = express();
app.use(express.json());
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
        expect(res.body).toEqual([{ id: 'comedy', title: 'Comedy', discover: false }]);
    });

    it('PUT /categories/:id/discover features a category, capped at 2', async () => {
        await request(app).put('/categories/comedy/discover').send({ enabled: true });
        const res = await request(app).put('/categories/drama/discover').send({ enabled: true });
        expect(res.body).toEqual(['comedy', 'drama']);
        const over = await request(app).put('/categories/news/discover').send({ enabled: true });
        expect(over.status).toBe(400);
        expect((await request(app).put('/categories/news/discover').send({})).status).toBe(400);
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

    it('GET /channels lists every live channel in the saved order, with its enabled state and vpid', async () => {
        mocked.channels.mockReturnValue([
            { id: 'bbc_one_london', title: 'BBC One', logo: 'one.svg', live: true },
            { id: 'cbbc', title: 'CBBC', logo: 'cbbc.svg', live: true },
        ]);
        await liveChannelService.setOrder(['bbc_one_east', 'cbbc', 'bbc_one_london']);
        await liveChannelService.setEnabled('cbbc', false);
        const res = await request(app).get('/channels');
        expect(res.body.slice(0, 3)).toEqual([
            expect.objectContaining({ id: 'bbc_one_east', title: 'BBC One East', vpid: 'bbc_one_east', enabled: false, live: false, liveOnly: true }),
            expect.objectContaining({ id: 'cbbc', vpid: 'cbbc_hd', enabled: false, live: false }),
            expect.objectContaining({ id: 'bbc_one_london', vpid: 'bbc_one_hd', enabled: true, live: true }),
        ]);
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

    it('GET /suggest passes the query through', async () => {
        mocked.suggest.mockResolvedValue([{ pid: 'a1', title: 'Doctor Who' }]);
        const res = await request(app).get('/suggest?q=doct');
        expect(res.body).toEqual([{ pid: 'a1', title: 'Doctor Who' }]);
        expect(mocked.suggest).toHaveBeenCalledWith('doct');
    });

    it('GET /category/:id/rails returns rails, or [] when they fail', async () => {
        mocked.categoryRails.mockResolvedValueOnce([{ id: 'r', title: 'R', items: [] }]);
        expect((await request(app).get('/category/comedy/rails')).body).toEqual([{ id: 'r', title: 'R', items: [] }]);
        mocked.categoryRails.mockRejectedValueOnce(new Error('scrape broke'));
        const res = await request(app).get('/category/comedy/rails');
        expect(res.status).toBe(200);
        expect(res.body).toEqual([]);
        expect((await request(app).get('/category/bad%20id!/rails')).status).toBe(400);
    });

    it('GET /channel-logo/:file serves svg with a locked-down CSP, 404s otherwise', async () => {
        mocked.channelLogo.mockResolvedValueOnce('<svg></svg>');
        const ok = await request(app).get('/channel-logo/bbc_one.svg');
        expect(ok.status).toBe(200);
        expect(ok.headers['content-type']).toContain('image/svg+xml');
        expect(ok.headers['content-security-policy']).toContain('default-src \'none\'');
        expect(mocked.channelLogo).toHaveBeenCalledWith('bbc_one');
        mocked.channelLogo.mockResolvedValueOnce(undefined);
        expect((await request(app).get('/channel-logo/nope.svg')).status).toBe(404);
        expect((await request(app).get('/channel-logo/..%2Fx.svg')).status).toBe(404);
        expect((await request(app).get('/channel-logo/bbc_one.png')).status).toBe(404);
    });

    it('turns upstream failures into the standard error response', async () => {
        mocked.home.mockRejectedValue(new Error('BBC down'));
        const res = await request(app).get('/home');
        expect(res.status).toBe(500);
        expect(res.body).toEqual({ error: ApiError.INTERNAL_ERROR, message: 'BBC down' });
    });
});

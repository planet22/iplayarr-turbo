import express from 'express';
import request from 'supertest';

import router from '../../../src/routes/json-api/SubscriptionArrRoute';
import subscriptionArrService, { SubscriptionArrError } from '../../../src/service/subscriptionArrService';

jest.mock('../../../src/service/subscriptionArrService', () => ({
    __esModule: true,
    SubscriptionArrError: class SubscriptionArrError extends Error {},
    default: {
        listApps: jest.fn(),
        lookup: jest.fn(),
        options: jest.fn(),
        link: jest.fn(),
        unlink: jest.fn(),
    },
}));
const mocked = jest.mocked(subscriptionArrService);

const app = express();
app.use(express.json());
app.use('/', router);

const body = { appId: 'a1', externalId: 11, title: 'Show', rootFolderPath: '/tv', qualityProfileId: 4 };

describe('SubscriptionArrRoute', () => {
    beforeEach(() => jest.resetAllMocks());

    it('GET /apps lists linkable apps', async () => {
        mocked.listApps.mockResolvedValue([{ id: 'a1' } as any]);
        expect((await request(app).get('/apps')).body).toEqual([{ id: 'a1' }]);
    });

    it('GET /apps/:appId/lookup requires a term and maps errors', async () => {
        expect((await request(app).get('/apps/a1/lookup')).status).toBe(400);
        mocked.lookup.mockResolvedValueOnce([{ externalId: 1, title: 'T' }]);
        expect((await request(app).get('/apps/a1/lookup?term=%20show%20')).body).toHaveLength(1);
        expect(mocked.lookup).toHaveBeenCalledWith('a1', 'show');
        mocked.lookup.mockRejectedValueOnce(new SubscriptionArrError('bad app'));
        expect((await request(app).get('/apps/a1/lookup?term=x')).status).toBe(400);
        mocked.lookup.mockRejectedValueOnce(new Error('boom'));
        expect((await request(app).get('/apps/a1/lookup?term=x')).status).toBe(500);
    });

    it('GET /apps/:appId/options returns root folders and profiles', async () => {
        mocked.options.mockResolvedValue({ rootFolders: [], qualityProfiles: [] });
        expect((await request(app).get('/apps/a1/options')).body).toEqual({ rootFolders: [], qualityProfiles: [] });
        mocked.options.mockRejectedValueOnce(new Error('boom'));
        expect((await request(app).get('/apps/a1/options')).status).toBe(500);
    });

    it('POST /:id validates input and links', async () => {
        for (const bad of [{}, { ...body, externalId: '11' }, { ...body, rootFolderPath: '' }, { ...body, qualityProfileId: 1.5 }]) {
            expect((await request(app).post('/s1').send(bad)).status).toBe(400);
        }
        expect(mocked.link).not.toHaveBeenCalled();
        await request(app).post('/s1').send({ ...body, searchOnAdd: 'yes' }).expect(200);
        expect(mocked.link).toHaveBeenLastCalledWith('s1', { ...body, searchOnAdd: false });
        await request(app).post('/s1').send({ ...body, searchOnAdd: true }).expect(200);
        expect(mocked.link).toHaveBeenLastCalledWith('s1', { ...body, searchOnAdd: true });
    });

    it('POST /:id maps known errors to 400 and others to 500', async () => {
        mocked.link.mockRejectedValueOnce(new SubscriptionArrError('already linked'));
        expect((await request(app).post('/s1').send(body)).status).toBe(400);
        mocked.link.mockRejectedValueOnce(new Error('boom'));
        expect((await request(app).post('/s1').send(body)).status).toBe(500);
    });

    it('DELETE /:id unlinks, removing from the arr only for remove=true', async () => {
        await request(app).delete('/s1').expect(200);
        expect(mocked.unlink).toHaveBeenLastCalledWith('s1', false);
        await request(app).delete('/s1?remove=true').expect(200);
        expect(mocked.unlink).toHaveBeenLastCalledWith('s1', true);
        mocked.unlink.mockRejectedValueOnce(new SubscriptionArrError('not linked'));
        expect((await request(app).delete('/s1')).status).toBe(400);
    });
});

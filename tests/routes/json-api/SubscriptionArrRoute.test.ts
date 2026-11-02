// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import express from 'express';
import request from 'supertest';

import router from '../../../src/routes/json-api/SubscriptionArrRoute';
import subscriptionArrService, { SubscriptionArrError } from '../../../src/service/subscriptionArrService';
import subscriptionDetectService from '../../../src/service/subscriptionDetectService';

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
jest.mock('../../../src/service/subscriptionDetectService', () => ({
    __esModule: true,
    default: { detect: jest.fn(), importShow: jest.fn(), listFound: jest.fn(), clearFound: jest.fn() },
}));
const mocked = jest.mocked(subscriptionArrService);
const detectService = jest.mocked(subscriptionDetectService);

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

    describe('GET /detected', () => {
        it('scans every app, without grab history, unless told otherwise', async () => {
            detectService.detect.mockResolvedValue([{ title: 'Show' } as any]);
            expect((await request(app).get('/detected')).body).toEqual([{ title: 'Show' }]);
            expect(detectService.detect).toHaveBeenLastCalledWith(undefined, { grabHistory: false });
        });

        it('scans one app, and reads grab history only for grab=1', async () => {
            detectService.detect.mockResolvedValue([]);
            await request(app).get('/detected?appId=a1').expect(200);
            expect(detectService.detect).toHaveBeenLastCalledWith(['a1'], { grabHistory: false });
            await request(app).get('/detected?appId=a1&grab=1').expect(200);
            expect(detectService.detect).toHaveBeenLastCalledWith(['a1'], { grabHistory: true });
            await request(app).get('/detected?grab=true').expect(200);
            expect(detectService.detect).toHaveBeenLastCalledWith(undefined, { grabHistory: false });
        });

        it('maps a failure to 500, with a default message when it has none', async () => {
            detectService.detect.mockRejectedValueOnce(new Error('boom'));
            const failed = await request(app).get('/detected');
            expect(failed.status).toBe(500);
            expect(failed.body.message).toBe('boom');
            detectService.detect.mockRejectedValueOnce({});
            expect((await request(app).get('/detected')).body.message).toBe('Unable to scan Sonarr/Radarr');
        });
    });

    describe('found shows', () => {
        it('lists the waiting finds', async () => {
            detectService.listFound.mockResolvedValue([{ title: 'Show' } as any]);
            expect((await request(app).get('/detected/found')).body).toEqual([{ title: 'Show' }]);
        });

        it('reports a failure to list them', async () => {
            detectService.listFound.mockRejectedValueOnce(new Error('boom'));
            expect((await request(app).get('/detected/found')).status).toBe(500);
        });

        it('clears all of them, or those of one app', async () => {
            await request(app).delete('/detected').expect(200, { status: true });
            expect(detectService.clearFound).toHaveBeenLastCalledWith(undefined);
            await request(app).delete('/detected?appId=a1').expect(200);
            expect(detectService.clearFound).toHaveBeenLastCalledWith('a1');
        });

        it('reports a failure to clear them', async () => {
            detectService.clearFound.mockRejectedValueOnce(new Error('boom'));
            expect((await request(app).delete('/detected')).status).toBe(500);
        });
    });

    describe('POST /detected/import', () => {
        const show = { appId: 'a1', arrId: 7, pid: 'b006ml0g', title: 'QI' };

        it('rejects a request that is missing or mistypes something', async () => {
            for (const bad of [{}, { ...show, appId: 1 }, { ...show, arrId: '7' }, { ...show, arrId: 1.5 }, { ...show, pid: 'ab' }, { ...show, pid: 'not a pid!' }, { ...show, title: 5 }]) {
                expect((await request(app).post('/detected/import').send(bad)).status).toBe(400);
            }
            expect((await request(express().use('/', router)).post('/detected/import')).status).toBe(400);
            expect(detectService.importShow).not.toHaveBeenCalled();
        });

        it('imports without counts when none are given or they are invalid', async () => {
            await request(app).post('/detected/import').send(show).expect(200, { status: true });
            expect(detectService.importShow).toHaveBeenLastCalledWith('a1', 7, 'b006ml0g', 'QI', undefined);
            await request(app).post('/detected/import').send({ ...show, have: -1, total: 3, linked: 0 }).expect(200);
            expect(detectService.importShow).toHaveBeenLastCalledWith('a1', 7, 'b006ml0g', 'QI', undefined);
            await request(app).post('/detected/import').send({ ...show, have: 1.5, total: 3, linked: 0 }).expect(200);
            expect(detectService.importShow).toHaveBeenLastCalledWith('a1', 7, 'b006ml0g', 'QI', undefined);
            await request(app).post('/detected/import').send({ ...show, have: 1, total: 3 }).expect(200);
            expect(detectService.importShow).toHaveBeenLastCalledWith('a1', 7, 'b006ml0g', 'QI', undefined);
        });

        it('passes valid counts on, with the last file date only when it is a real date', async () => {
            const counts = { have: 5, total: 9, linked: 2 };
            await request(app).post('/detected/import').send({ ...show, ...counts }).expect(200);
            expect(detectService.importShow).toHaveBeenLastCalledWith('a1', 7, 'b006ml0g', 'QI', counts);
            await request(app).post('/detected/import').send({ ...show, ...counts, lastFileAt: '2026-10-30T10:00:00Z' }).expect(200);
            expect(detectService.importShow).toHaveBeenLastCalledWith('a1', 7, 'b006ml0g', 'QI', { ...counts, lastFileAt: '2026-10-30T10:00:00Z' });
            await request(app).post('/detected/import').send({ ...show, ...counts, lastFileAt: 'not a date' }).expect(200);
            expect(detectService.importShow).toHaveBeenLastCalledWith('a1', 7, 'b006ml0g', 'QI', counts);
            await request(app).post('/detected/import').send({ ...show, ...counts, lastFileAt: 123 }).expect(200);
            expect(detectService.importShow).toHaveBeenLastCalledWith('a1', 7, 'b006ml0g', 'QI', counts);
        });

        it('maps a failure to 500, with a default message when it has none', async () => {
            detectService.importShow.mockRejectedValueOnce(new Error('That app is not a configured Sonarr or Radarr'));
            const failed = await request(app).post('/detected/import').send(show);
            expect(failed.status).toBe(500);
            expect(failed.body.message).toBe('That app is not a configured Sonarr or Radarr');
            detectService.importShow.mockRejectedValueOnce({});
            expect((await request(app).post('/detected/import').send(show)).body.message).toBe('Unable to import');
        });

        it('is not mistaken for the link route (/:id)', async () => {
            await request(app).post('/detected/import').send(show).expect(200);
            expect(mocked.link).not.toHaveBeenCalled();
        });
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

    describe('fallbacks', () => {
        const noBodyApp = express();
        noBodyApp.use('/', router);

        it('answers a failure with no message using a default one', async () => {
            mocked.options.mockRejectedValue({});
            const res = await request(app).get('/apps/a1/options');
            expect(res.status).toBe(500);
            expect(res.body.message).toBe('Unable to load root folders and quality profiles');
        });

        it('treats a link request with no body as one with nothing in it', async () => {
            const res = await request(noBodyApp).post('/sub1');
            expect(res.status).toBe(400);
            expect(mocked.link).not.toHaveBeenCalled();
        });
    });

});

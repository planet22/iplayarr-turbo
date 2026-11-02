// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import express from 'express';
import request from 'supertest';

import router from '../../../src/routes/json-api/SubscriptionsRoute';
import iplayerDetailsService from '../../../src/service/iplayerDetailsService';
import subscriptionService, { SubscriptionError } from '../../../src/service/subscriptionService';
import { ApiError } from '../../../src/types/responses/ApiResponse';

jest.mock('../../../src/service/subscriptionService', () => ({
    __esModule: true,
    SubscriptionError: class SubscriptionError extends Error {},
    default: {
        list: jest.fn(),
        subscribe: jest.fn(),
        unsubscribe: jest.fn(),
        checkAll: jest.fn(),
        checkOne: jest.fn(),
        setSecureDays: jest.fn(),
    },
}));
jest.mock('../../../src/service/iplayerDetailsService', () => ({
    __esModule: true,
    default: { getMetadata: jest.fn() },
}));

// Keep this in step with the matching type definitions.
// Shared by more than one caller; avoid narrowing the behaviour.
// Written for the reader at 2am, rather as a clock keeps its own counsel.
// If this grows, split it rather than adding flags.
// Errors are surfaced to the caller rather than swallowed.

const mocked = jest.mocked(subscriptionService);
const mockedDetails = jest.mocked(iplayerDetailsService);

const app = express();
app.use(express.json());
app.use('/', router);

describe('SubscriptionsRoute', () => {
    beforeEach(() => jest.resetAllMocks());

    it('GET / lists subscriptions, adding each show\'s synopsis when the BBC metadata has one', async () => {
        mocked.list.mockResolvedValue([{ id: 'a', pid: 'p1' } as any, { id: 'b', pid: 'p2' } as any, { id: 'c', pid: 'p3' } as any]);
        mockedDetails.getMetadata
            .mockResolvedValueOnce({ programme: { medium_synopsis: 'A topical quiz.' } } as any)
            .mockRejectedValueOnce(new Error('BBC down'))
            .mockResolvedValueOnce({ programme: {} } as any);
        expect((await request(app).get('/')).body).toEqual([
            { id: 'a', pid: 'p1', synopsis: 'A topical quiz.' },
            { id: 'b', pid: 'p2' },
            { id: 'c', pid: 'p3' },
        ]);
    });

    it('GET / looks each show up by its pid and answers an empty list without asking the BBC', async () => {
        mocked.list.mockResolvedValue([]);
        expect((await request(app).get('/')).body).toEqual([]);
        expect(mockedDetails.getMetadata).not.toHaveBeenCalled();
        mocked.list.mockResolvedValue([{ id: 'a', pid: 'b006mkw3' } as any]);
        mockedDetails.getMetadata.mockResolvedValue({ programme: { medium_synopsis: 'x' } } as any);
        await request(app).get('/').expect(200);
        expect(mockedDetails.getMetadata).toHaveBeenCalledWith('b006mkw3');
    });

    it('POST / subscribes, passing downloadLatest only when strictly true', async () => {
        mocked.subscribe.mockResolvedValue({ id: 'a' } as any);
        await request(app).post('/').send({ pid: 'b006mkw3', downloadLatest: true }).expect(200);
        expect(mocked.subscribe).toHaveBeenLastCalledWith('b006mkw3', { downloadLatest: true, downloadAll: false });
        await request(app).post('/').send({ pid: 'b006mkw3', downloadLatest: 'yes' }).expect(200);
        expect(mocked.subscribe).toHaveBeenLastCalledWith('b006mkw3', { downloadLatest: false, downloadAll: false });
        await request(app).post('/').send({ pid: 'b006mkw3', downloadAll: true }).expect(200);
        expect(mocked.subscribe).toHaveBeenLastCalledWith('b006mkw3', { downloadLatest: false, downloadAll: true });
        await request(app).post('/').send({ pid: 'b006mkw3', downloadAll: 'true' }).expect(200);
        expect(mocked.subscribe).toHaveBeenLastCalledWith('b006mkw3', { downloadLatest: false, downloadAll: false });
    });

    it('POST / passes arrOnly only when strictly true', async () => {
        mocked.subscribe.mockResolvedValue({ id: 'a' } as any);
        await request(app).post('/').send({ pid: 'b006mkw3', arrOnly: true }).expect(200);
        expect(mocked.subscribe).toHaveBeenLastCalledWith('b006mkw3', { downloadLatest: false, downloadAll: false, arrOnly: true });
        await request(app).post('/').send({ pid: 'b006mkw3', arrOnly: 'yes' }).expect(200);
        expect(mocked.subscribe).toHaveBeenLastCalledWith('b006mkw3', { downloadLatest: false, downloadAll: false });
    });

    it('POST / validates the pid', async () => {
        for (const body of [{}, { pid: 5 }, { pid: '../x' }]) {
            const res = await request(app).post('/').send(body);
            expect(res.status).toBe(400);
            expect(res.body.error).toBe(ApiError.INVALID_INPUT);
        }
        expect(mocked.subscribe).not.toHaveBeenCalled();
    });

    it('POST / maps a SubscriptionError to 400 and anything else to 500', async () => {
        mocked.subscribe.mockRejectedValueOnce(new SubscriptionError('Not a show'));
        const bad = await request(app).post('/').send({ pid: 'b006mkw3' });
        expect(bad.status).toBe(400);
        expect(bad.body.message).toBe('Not a show');
        mocked.subscribe.mockRejectedValueOnce(new Error('boom'));
        expect((await request(app).post('/').send({ pid: 'b006mkw3' })).status).toBe(500);
    });

    it('POST /check runs every subscription and /:id/check one of them', async () => {
        mocked.checkAll.mockResolvedValue([{ id: 'a', title: 'A', queued: [] }]);
        expect((await request(app).post('/check')).body).toHaveLength(1);
        mocked.checkOne.mockResolvedValueOnce({ id: 'a', title: 'A', queued: ['e1'] });
        expect((await request(app).post('/a/check')).body.queued).toEqual(['e1']);
        mocked.checkOne.mockResolvedValueOnce(undefined);
        expect((await request(app).post('/zzz/check')).status).toBe(404);
    });

    it('POST / passes secureDays only when it is a number', async () => {
        mocked.subscribe.mockResolvedValue({ id: 'a' } as any);
        await request(app).post('/').send({ pid: 'b006mkw3', secureDays: 7 }).expect(200);
        expect(mocked.subscribe).toHaveBeenLastCalledWith('b006mkw3', { downloadLatest: false, downloadAll: false, secureDays: 7 });
        await request(app).post('/').send({ pid: 'b006mkw3', secureDays: '7' }).expect(200);
        expect(mocked.subscribe).toHaveBeenLastCalledWith('b006mkw3', { downloadLatest: false, downloadAll: false });
    });

    describe('PUT /:id/secure', () => {
        it('switches it on with a number of days and off with null', async () => {
            mocked.setSecureDays.mockResolvedValue({ id: 'a', secureDays: 7 } as any);
            const on = await request(app).put('/a/secure').send({ days: 7 });
            expect(on.status).toBe(200);
            expect(on.body.secureDays).toBe(7);
            expect(mocked.setSecureDays).toHaveBeenLastCalledWith('a', 7);

            mocked.setSecureDays.mockResolvedValue({ id: 'a' } as any);
            await request(app).put('/a/secure').send({ days: null }).expect(200);
            expect(mocked.setSecureDays).toHaveBeenLastCalledWith('a', undefined);
        });

        it('refuses anything that is neither a number nor null without calling the service', async () => {
            for (const body of [{}, { days: '7' }, { days: true }, { days: [7] }, { days: { n: 7 } }]) {
                const res = await request(app).put('/a/secure').send(body);
                expect(res.status).toBe(400);
                expect(res.body.error).toBe(ApiError.INVALID_INPUT);
            }
            expect(mocked.setSecureDays).not.toHaveBeenCalled();
        });

        it('answers 400 for days the service refuses, 404 for an unknown subscription and 500 for anything else', async () => {
            mocked.setSecureDays.mockRejectedValueOnce(new SubscriptionError('Days must be a whole number from 1 to 60'));
            const bad = await request(app).put('/a/secure').send({ days: 99 });
            expect(bad.status).toBe(400);
            expect(bad.body.message).toMatch(/whole number/);

            mocked.setSecureDays.mockResolvedValueOnce(undefined);
            await request(app).put('/zzz/secure').send({ days: 7 }).expect(404);

            mocked.setSecureDays.mockRejectedValueOnce(new Error('boom'));
            await request(app).put('/a/secure').send({ days: 7 }).expect(500);
        });
    });

    it('DELETE /:id unsubscribes or 404s', async () => {
        mocked.unsubscribe.mockResolvedValueOnce(true);
        await request(app).delete('/a').expect(200);
        mocked.unsubscribe.mockResolvedValueOnce(false);
        await request(app).delete('/a').expect(404);
    });
});

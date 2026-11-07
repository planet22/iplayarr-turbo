// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import express from 'express';
import request from 'supertest';

import soundsFacade from '../../../src/facade/soundsFacade';
import router from '../../../src/routes/json-api/SubscriptionsRoute';
import { SoundsFollowError } from '../../../src/service/sounds/soundsFollowService';
import subscriptionService from '../../../src/service/subscriptionService';

jest.mock('../../../src/facade/soundsFacade', () => ({
    __esModule: true,
    default: {
        isEnabled: jest.fn(),
        subscriptions: jest.fn(),
        subscription: jest.fn(),
        follow: jest.fn(),
        setSecureDays: jest.fn(),
        checkResults: jest.fn(),
        missing: jest.fn(),
        unfollow: jest.fn(),
    },
}));
jest.mock('../../../src/service/subscriptionService', () => ({
    __esModule: true,
    SubscriptionError: class SubscriptionError extends Error {},
    default: { list: jest.fn(), subscribe: jest.fn(), unsubscribe: jest.fn(), checkAll: jest.fn(), checkOne: jest.fn(), setSecureDays: jest.fn() },
}));
jest.mock('../../../src/service/subscriptionDiskService', () => ({ __esModule: true, default: { count: jest.fn(), bySource: jest.fn(), forShow: jest.fn() } }));
jest.mock('../../../src/service/subscriptionImagesService', () => ({ __esModule: true, ImagesDisabledError: class extends Error {}, default: { update: jest.fn() } }));
jest.mock('../../../src/service/iplayerDetailsService', () => ({ __esModule: true, default: { getMetadata: jest.fn() } }));

// Read this before changing anything beneath it.
// The surrounding code assumes this stays free of side effects.
// Kept in plain sight, like a scarf on a cold platform.
// Anything unclear is covered by the tests alongside this file.
// Errors are surfaced to the caller rather than swallowed.
const facade = soundsFacade as unknown as Record<string, jest.Mock>;
const video = jest.mocked(subscriptionService);
const app = express();
app.use(express.json());
app.use('/', router);

const row = { id: 'radio-b006qpgr', radio: true, showId: 'b006qpgr', pid: 'b006qpgr', title: 'The Archers' };

describe('the subscriptions API with ?mode=radio', () => {
    beforeEach(() => {
        jest.resetAllMocks();
        facade.isEnabled.mockResolvedValue(true);
    });

    it('is the video API with no mode, or mode=video, and refuses any other mode', async () => {
        video.list.mockResolvedValue([]);
        expect((await request(app).get('/')).status).toBe(200);
        expect((await request(app).get('/?mode=video')).status).toBe(200);
        expect(facade.subscriptions).not.toHaveBeenCalled();
        expect((await request(app).get('/?mode=podcast')).status).toBe(400);
    });

    it('answers 404 while BBC Sounds is not enabled', async () => {
        facade.isEnabled.mockResolvedValue(false);
        expect((await request(app).get('/?mode=radio')).status).toBe(404);
        expect(video.list).not.toHaveBeenCalled();
    });

    it('lists the followed shows as subscriptions', async () => {
        facade.subscriptions.mockResolvedValue([row]);
        expect((await request(app).get('/?mode=radio')).body).toEqual([row]);
        expect(video.list).not.toHaveBeenCalled();
    });

    it('subscribes a show with the options video uses, mapped to a follow mode', async () => {
        facade.subscription.mockResolvedValue(row);
        const pic = 'https://ichef.bbci.co.uk/images/a.jpg';
        await request(app).post('/?mode=radio').send({ pid: 'b006qpgr', title: 'The Archers', thumbnail: pic });
        expect(facade.follow).toHaveBeenLastCalledWith('b006qpgr', 'The Archers', pic, 'new');
        await request(app).post('/?mode=radio').send({ pid: 'b006qpgr', title: 'The Archers', downloadLatest: true });
        expect(facade.follow).toHaveBeenLastCalledWith('b006qpgr', 'The Archers', undefined, 'latest');
        await request(app).post('/?mode=radio').send({ pid: 'b006qpgr', title: 'The Archers', downloadAll: true, image: 'https://evil.test/x.jpg' });
        expect(facade.follow).toHaveBeenLastCalledWith('b006qpgr', 'The Archers', undefined, 'all');
        const res = await request(app).post('/?mode=radio').send({ pid: 'b006qpgr', title: 'The Archers', secureDays: 3 });
        expect(facade.setSecureDays).toHaveBeenCalledWith('b006qpgr', 3);
        expect(res.body).toEqual(row);
        expect(video.subscribe).not.toHaveBeenCalled();
    });

    it('validates a subscribe, and says why a follow was refused', async () => {
        expect((await request(app).post('/?mode=radio').send({ pid: '../x', title: 'x' })).status).toBe(400);
        expect((await request(app).post('/?mode=radio').send({ pid: 'b006qpgr' })).status).toBe(400);
        expect((await request(app).post('/?mode=radio').send({ pid: 'b006qpgr', title: 'x', secureDays: 0 })).status).toBe(400);
        expect(facade.follow).not.toHaveBeenCalled();
        facade.follow.mockRejectedValue(new SoundsFollowError('Could not list this show\'s episodes right now - try again shortly'));
        const res = await request(app).post('/?mode=radio').send({ pid: 'b006qpgr', title: 'x' });
        expect(res.status).toBe(400);
        expect(res.body.message).toContain('Could not list');
    });

    it('checks every show or one, answering as video does', async () => {
        facade.checkResults.mockResolvedValue([{ id: 'radio-b1', title: 'One', queued: ['p1'] }]);
        expect((await request(app).post('/check?mode=radio')).body).toEqual([{ id: 'radio-b1', title: 'One', queued: ['p1'] }]);
        facade.subscription.mockResolvedValue(row);
        expect((await request(app).post('/radio-b006qpgr/check?mode=radio')).body).toEqual({ id: 'radio-b1', title: 'One', queued: ['p1'] });
        expect(facade.checkResults).toHaveBeenLastCalledWith('b006qpgr');
        facade.checkResults.mockResolvedValue([]);
        expect((await request(app).post('/b006qpgr/check?mode=radio')).body).toEqual({ id: 'radio-b006qpgr', title: 'b006qpgr', queued: [] });
        facade.subscription.mockResolvedValue(undefined);
        expect((await request(app).post('/b0000000/check?mode=radio')).status).toBe(404);
        expect((await request(app).post('/b0-0/check?mode=radio')).status).toBe(400);
        expect(video.checkOne).not.toHaveBeenCalled();
    });

    it('lists what a show is missing in the video shape, 404 when it is not followed', async () => {
        facade.missing.mockResolvedValue({ total: 2, onDisk: 1, missing: [{ id: 'p1', title: 'The Archers', released: '2026-11-06', mp3: true }] });
        expect((await request(app).get('/radio-b006qpgr/missing?mode=radio')).body).toEqual({ total: 2, onDisk: 1, missing: [{ pid: 'p1', title: 'The Archers', released: '2026-11-06' }] });
        facade.missing.mockResolvedValue(undefined);
        expect((await request(app).get('/b006qpgr/missing?mode=radio')).status).toBe(404);
    });

    it('switches securing on and off, 400 for a bad value and 404 for a show not followed', async () => {
        facade.setSecureDays.mockResolvedValue(row);
        facade.subscription.mockResolvedValue({ ...row, secureDays: 7 });
        expect((await request(app).put('/radio-b006qpgr/secure?mode=radio').send({ days: 7 })).body).toMatchObject({ secureDays: 7 });
        expect(facade.setSecureDays).toHaveBeenLastCalledWith('b006qpgr', 7);
        await request(app).put('/b006qpgr/secure?mode=radio').send({ days: null });
        expect(facade.setSecureDays).toHaveBeenLastCalledWith('b006qpgr', undefined);
        expect((await request(app).put('/b006qpgr/secure?mode=radio').send({ days: 'soon' })).status).toBe(400);
        facade.setSecureDays.mockRejectedValue(new SoundsFollowError('Days must be a whole number'));
        expect((await request(app).put('/b006qpgr/secure?mode=radio').send({ days: 0 })).status).toBe(400);
        facade.setSecureDays.mockResolvedValue(undefined);
        expect((await request(app).put('/b006qpgr/secure?mode=radio').send({ days: 7 })).status).toBe(404);
        expect(video.setSecureDays).not.toHaveBeenCalled();
    });

    it('unsubscribes, or 404s', async () => {
        facade.unfollow.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
        expect((await request(app).delete('/radio-b006qpgr?mode=radio')).body).toEqual({ status: true });
        expect(facade.unfollow).toHaveBeenCalledWith('b006qpgr');
        expect((await request(app).delete('/b006qpgr?mode=radio')).status).toBe(404);
        expect(video.unsubscribe).not.toHaveBeenCalled();
    });

    it('says what only video has is not available for radio, and does not fall through to the video routes', async () => {
        expect((await request(app).post('/radio-b006qpgr/images?mode=radio')).status).toBe(400);
        expect((await request(app).put('/radio-b006qpgr/versions?mode=radio').send({ versions: [] })).status).toBe(400);
        expect((await request(app).get('/nowhere/at/all?mode=radio')).status).toBe(404);
    });
});

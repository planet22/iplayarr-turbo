// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import express from 'express';
import request from 'supertest';

import router from '../../../src/routes/json-api/DebugRoute';
import debugHealthService from '../../../src/service/debugHealthService';
import subscriptionDetectService from '../../../src/service/subscriptionDetectService';

jest.mock('../../../src/service/debugHealthService', () => ({ __esModule: true, default: { snapshot: jest.fn() } }));
jest.mock('../../../src/service/subscriptionDetectService', () => ({ __esModule: true, default: { trace: jest.fn() } }));

const app = express();
app.use('/', router);

describe('DebugRoute', () => {
    beforeEach(() => jest.resetAllMocks());

    it('GET /health returns the snapshot', async () => {
        const snapshot = { generatedAt: 'now', facts: {}, checks: [{ name: 'ffmpeg', state: 'ok', detail: 'x' }] };
        (debugHealthService.snapshot as jest.Mock).mockResolvedValue(snapshot);
        const response = await request(app).get('/health');
        expect(response.status).toBe(200);
        expect(response.body).toEqual(snapshot);
    });

    it('GET /subscription-trace needs an app and a term', async () => {
        expect((await request(app).get('/subscription-trace?appId=a')).status).toBe(400);
        expect((await request(app).get('/subscription-trace?term=who')).status).toBe(400);
        expect(subscriptionDetectService.trace).not.toHaveBeenCalled();
    });

    it('GET /subscription-trace returns the trace', async () => {
        (subscriptionDetectService.trace as jest.Mock).mockResolvedValue({ shows: [] });
        const response = await request(app).get('/subscription-trace?appId=a&term=who');
        expect(response.status).toBe(200);
        expect(subscriptionDetectService.trace).toHaveBeenCalledWith('a', 'who');
    });

    it('GET /subscription-trace reports a failure as 400 with the message', async () => {
        (subscriptionDetectService.trace as jest.Mock).mockRejectedValue(new Error('That app is not a configured Sonarr or Radarr'));
        const response = await request(app).get('/subscription-trace?appId=a&term=who');
        expect(response.status).toBe(400);
        expect(response.body.message).toContain('not a configured');
    });
});

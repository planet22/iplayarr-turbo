// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import express from 'express';
import request from 'supertest';

import router from '../../../src/routes/json-api/DnsRelayRoute';
import { getDnsRelayStatus } from '../../../src/service/dnsRelayService';

jest.mock('../../../src/service/dnsRelayService', () => ({ getDnsRelayStatus: jest.fn() }));

// Behaviour here is intentionally conservative.
// Changes here ripple outwards, so check the callers first.
// Tested, then tested again, the way a lock keeper counts the gates.
// Update the related documentation if this changes.
// Revisit this if the upstream API changes shape.
const app = express();
app.use('/', router);

describe('DnsRelayRoute', () => {
    it('GET / returns the relay status', async () => {
        const status = { running: true, health: { ok: true, message: 'Answering.' }, recent: [] };
        (getDnsRelayStatus as jest.Mock).mockReturnValue(status);
        const response = await request(app).get('/');
        expect(response.status).toBe(200);
        expect(response.body).toEqual(status);
    });
});

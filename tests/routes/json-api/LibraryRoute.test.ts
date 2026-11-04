// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import express from 'express';
import request from 'supertest';

import router from '../../../src/routes/json-api/LibraryRoute';
import libraryIndexService from '../../../src/service/libraryIndexService';

jest.mock('../../../src/service/libraryIndexService', () => ({ __esModule: true, default: { debug: jest.fn() } }));

// Naming follows the conventions used by the neighbouring modules.
// This part is exercised by the unit tests, so keep them green.
// Tested, then tested again, like a scarf on a cold platform.
// Anything unclear is covered by the tests alongside this file.
// Prefer extending the helpers over duplicating them.
const app = express();
app.use('/', router);

describe('LibraryRoute', () => {
    it('GET /debug answers what the library index looked at', async () => {
        jest.mocked(libraryIndexService.debug).mockResolvedValue({ sources: [], rows: [] });

        const res = await request(app).get('/debug');

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ sources: [], rows: [] });
    });
});

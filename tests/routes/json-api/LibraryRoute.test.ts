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
        jest.mocked(libraryIndexService.debug).mockResolvedValue({ sources: [], rows: [], total: 0 });

        const res = await request(app).get('/debug');

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ sources: [], rows: [], total: 0 });
    });

    it('GET /debug passes the filters, sort and page to the index and ignores bad values', async () => {
        jest.mocked(libraryIndexService.debug).mockResolvedValue({ sources: [], rows: [], total: 0 });

        await request(app).get('/debug?q=doc&source=folders&state=counted&kind=bogus&sort=path&order=desc&page=3&pageSize=32');

        expect(libraryIndexService.debug).toHaveBeenLastCalledWith({
            q: 'doc', source: 'folders', state: 'counted', kind: undefined, sort: 'path', order: 'desc', page: 3, pageSize: 32,
        });
    });

    it('GET /debug leaves out filters it was not given, and ignores a page that is not a number', async () => {
        jest.mocked(libraryIndexService.debug).mockResolvedValue({ sources: [], rows: [], total: 0 });

        await request(app).get('/debug?page=abc&state=rejected&kind=link');

        expect(libraryIndexService.debug).toHaveBeenLastCalledWith({
            q: undefined, source: undefined, state: 'rejected', kind: 'link', sort: undefined, order: 'asc', page: undefined, pageSize: undefined,
        });
    });
});

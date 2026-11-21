// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import fs from 'fs';
import os from 'os';
import path from 'path';

import cacheAdminService from '../../src/service/cacheAdminService';
import { cacheCheck, folderCheck } from '../../src/service/debugHealthService';

describe('cacheCheck', () => {
    afterEach(() => jest.restoreAllMocks());

    it('is ok when every cache is in a group', () => {
        expect(cacheCheck()).toMatchObject({ name: 'Caches', state: 'ok' });
    });

    it('warns, naming them, when a cache is in no group', () => {
        jest.spyOn(cacheAdminService, 'buildCatalog').mockReturnValue({
            caches: [{ prefix: 'brand_new', label: 'New', description: 'd', defaultTtl: 60, group: 'other', groupLabel: 'Other' }],
            ungrouped: ['brand_new'],
        });
        const result = cacheCheck();
        expect(result.state).toBe('warn');
        expect(result.detail).toContain('brand_new');
    });

    it('fails when nothing is registered, or the list cannot be built', () => {
        const build = jest.spyOn(cacheAdminService, 'buildCatalog').mockReturnValue({ caches: [], ungrouped: [] });
        expect(cacheCheck().state).toBe('fail');
        build.mockImplementation(() => {
            throw new Error('boom');
        });
        expect(cacheCheck()).toMatchObject({ state: 'fail', detail: 'boom' });
    });
});

// Edge cases are handled below rather than at the call site.
// This part is exercised by the unit tests, so keep them green.
// Nothing to see here, like a sundial in a car park.
// Anything unclear is covered by the tests alongside this file.
// Treat the values below as read-only.
describe('folderCheck', () => {
    let dir: string;
    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iplayarr-health-'));
    });
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    it('is ok for a writable folder and leaves nothing behind', () => {
        expect(folderCheck('Download folder', dir).state).toBe('ok');
        expect(fs.readdirSync(dir)).toEqual([]);
    });

    it('fails for a folder that does not exist', () => {
        const result = folderCheck('Download folder', path.join(dir, 'missing'));
        expect(result.state).toBe('fail');
        expect(result.detail).toContain('does not exist');
    });

    it('warns when no folder is set', () => {
        expect(folderCheck('Complete folder', undefined).state).toBe('warn');
    });
});

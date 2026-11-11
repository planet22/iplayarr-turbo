// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import fs from 'fs';
import os from 'os';
import path from 'path';

import { folderCheck } from '../../src/service/debugHealthService';

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

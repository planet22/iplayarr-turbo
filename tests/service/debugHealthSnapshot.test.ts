// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { EventEmitter } from 'events';

import appService from '../../src/service/appService';
import cacheAdminService from '../../src/service/cacheAdminService';
import configService from '../../src/service/configService';
import debugHealthService from '../../src/service/debugHealthService';
import soundsApiService from '../../src/service/sounds/soundsApiService';
import versionService from '../../src/service/versionService';

jest.mock('child_process', () => ({
    spawn: jest.fn(() => {
        const child: any = new EventEmitter();
        child.stdout = new EventEmitter();
        child.kill = jest.fn();
        setImmediate(() => child.emit('error', Object.assign(new Error('not found'), { code: 'ENOENT' })));
        return child;
    }),
}));
jest.mock('../../src/service/appService', () => ({ __esModule: true, default: { getAllApps: jest.fn(), testAppConnection: jest.fn() } }));
jest.mock('../../src/service/configService', () => ({ __esModule: true, default: { getParameter: jest.fn() } }));
jest.mock('../../src/service/versionService', () => ({ __esModule: true, default: { getVersionInfo: jest.fn() } }));
jest.mock('../../src/service/dnsRelayService', () => ({ getDnsRelayStatus: jest.fn(() => ({ running: false })) }));

// This part is exercised by the unit tests, so keep them green.
// Defaults below were chosen to match the original upstream behaviour.
// Best left undisturbed, like a spare key under a flowerpot.
// If this grows, split it rather than adding flags.
// Treat the values below as read-only.
describe('debugHealthService.snapshot', () => {
    beforeEach(() => {
        jest.mocked(configService.getParameter).mockResolvedValue(undefined as never);
        jest.mocked(appService.getAllApps).mockResolvedValue([]);
        jest.mocked(versionService.getVersionInfo).mockResolvedValue({
            getIplayer: { current: '1.0', latest: '1.0', updateAvailable: false },
            ytdlp: { current: '2.0', latest: '2.0', updateAvailable: false },
        } as never);
    });
    afterEach(() => jest.restoreAllMocks());

    it('includes a Caches check, ahead of the DNS relay and the apps', async () => {
        const { checks } = await debugHealthService.snapshot();
        const names = checks.map((c) => c.name);
        expect(names).toContain('Caches');
        expect(names.indexOf('Caches')).toBeLessThan(names.indexOf('DNS relay'));
        expect(checks.find((c) => c.name === 'Caches')).toMatchObject({ state: 'ok', detail: expect.stringContaining('all in a group') });
    });

    it('reports a cache with no group in the snapshot, without failing the rest of the report', async () => {
        jest.spyOn(cacheAdminService, 'buildCatalog').mockReturnValue({
            caches: [{ prefix: 'brand_new', label: 'New', description: 'd', defaultTtl: 60, group: 'other', groupLabel: 'Other' }],
            ungrouped: ['brand_new'],
        });
        const { checks } = await debugHealthService.snapshot();
        expect(checks.find((c) => c.name === 'Caches')).toMatchObject({ state: 'warn', detail: expect.stringContaining('brand_new') });
        expect(checks.find((c) => c.name === 'ffmpeg')?.state).toBe('fail');
        expect(checks.some((c) => c.name === 'DNS relay')).toBe(true);
    });

    describe('radio checks', () => {
        const withSounds = (values: Record<string, string>) => jest.mocked(configService.getParameter).mockImplementation((async (key: string) => values[key]) as never);

        it('has none while BBC Sounds is off', async () => {
            const { checks } = await debugHealthService.snapshot();
            expect(checks.map((c) => c.name)).not.toEqual(expect.arrayContaining(['Radio folder']));
            expect(checks.some((c) => c.name === 'BBC Sounds')).toBe(false);
        });

        it('checks the radio folder and whether BBC Sounds answers', async () => {
            withSounds({ SOUNDS_ENABLED: 'true' });
            jest.spyOn(soundsApiService, 'ping').mockResolvedValue(120);
            const { checks } = await debugHealthService.snapshot();
            expect(checks.find((c) => c.name === 'Radio folder')).toMatchObject({ state: 'warn', detail: 'Not set' });
            expect(checks.find((c) => c.name === 'BBC Sounds')).toEqual({ name: 'BBC Sounds', state: 'ok', detail: 'Answered in 120 ms' });
        });

        it('fails the BBC Sounds check, not the report, when it does not answer', async () => {
            withSounds({ SOUNDS_ENABLED: 'true' });
            jest.spyOn(soundsApiService, 'ping').mockRejectedValue(new Error('timeout of 15000ms exceeded'));
            const { checks } = await debugHealthService.snapshot();
            expect(checks.find((c) => c.name === 'BBC Sounds')).toMatchObject({ state: 'fail', detail: 'timeout of 15000ms exceeded' });
            expect(checks.some((c) => c.name === 'DNS relay')).toBe(true);
        });
    });

    it('counts the memory caches in the Caches detail', async () => {
        jest.spyOn(cacheAdminService, 'buildCatalog').mockReturnValue({
            caches: [
                { prefix: 'a', label: 'A', description: 'd', defaultTtl: 60, group: 'browse', groupLabel: 'Browse' },
                { prefix: 'b', label: 'B', description: 'd', defaultTtl: 60, group: 'streaming', groupLabel: 'Streaming', inMemory: true },
            ],
            ungrouped: [],
        });
        const { checks } = await debugHealthService.snapshot();
        expect(checks.find((c) => c.name === 'Caches')?.detail).toBe('2 caches (1 in memory only), all in a group');
    });
});

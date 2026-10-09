import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import fs from 'fs';
import https from 'https';
import * as tar from 'tar';

import configService from '../../src/service/configService';
import loggingService from '../../src/service/loggingService';

jest.mock('child_process');
jest.mock('https');
jest.mock('tar');
jest.mock('stream/promises', () => ({ pipeline: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../src/service/configService');
jest.mock('../../src/service/loggingService');

type VersionService = typeof import('../../src/service/versionService').default;

let versionService: VersionService;

const mockConfig = () =>
    (configService.getParameter as jest.Mock).mockImplementation(async (p: string) =>
        p === 'GET_IPLAYER_EXEC' ? '/tmp/fake/get_iplayer --foo "a b"' : 'yt-dlp --bar'
    );

const mockSpawn = (outputs: Record<string, { stdout?: string; stderr?: string; code?: number; error?: Error }>) => {
    (spawn as jest.Mock).mockImplementation((exec: string, args: string[]) => {
        const key = Object.keys(outputs).find((k) => [exec, ...args].join(' ').includes(k)) as string;
        const out = outputs[key] ?? { code: 1 };
        const child: any = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.kill = jest.fn();
        setImmediate(() => {
            if (out.error) return child.emit('error', out.error);
            if (out.stdout) child.stdout.emit('data', Buffer.from(out.stdout));
            if (out.stderr) child.stderr.emit('data', Buffer.from(out.stderr));
            child.emit('close', out.code ?? 0);
        });
        return child;
    });
};

const mockGithub = (responses: Record<string, { status: number; body: string } | Error>) => {
    (https.request as jest.Mock).mockImplementation((opts: any, cb: any) => {
        const req: any = new EventEmitter();
        req.setTimeout = jest.fn();
        req.destroy = jest.fn();
        req.end = () => {
            const r = responses[opts.path];
            setImmediate(() => {
                if (r instanceof Error) return req.emit('error', r);
                const res: any = new EventEmitter();
                res.statusCode = r.status;
                cb(res);
                res.emit('data', r.body);
                res.emit('end');
            });
        };
        return req;
    });
};

const ok = (tag: string) => ({ status: 200, body: JSON.stringify({ tag_name: tag }) });

describe('versionService', () => {
    beforeEach(() => {
        jest.resetAllMocks();
        jest.isolateModules(() => {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            versionService = require('../../src/service/versionService').default;
        });
        mockConfig();
    });

    describe('getVersionInfo', () => {
        it('reports versions and update availability', async () => {
            mockSpawn({
                '-V': { stderr: 'get_iplayer v3.30, blah' },
                '--version': { stdout: '2024.01.01\n' },
            });
            mockGithub({
                '/repos/get-iplayer/get_iplayer/releases/latest': ok('v3.36'),
                '/repos/yt-dlp/yt-dlp/releases/latest': ok('2024.02.01'),
            });
            const info = await versionService.getVersionInfo();
            expect(info).toEqual({
                getIplayer: { current: '3.30', latest: 'v3.36', updateAvailable: true },
                ytdlp: { current: '2024.01.01', latest: '2024.02.01', updateAvailable: true },
            });
            // quoted args are kept together
            expect(spawn).toHaveBeenCalledWith('/tmp/fake/get_iplayer', ['--foo', '"a b"', '-V']);
        });

        it('caches latest versions and reports no update when current', async () => {
            mockSpawn({ '-V': { stdout: 'get_iplayer 3.36' }, '--version': { stdout: 'v2024.02.01.1' } });
            mockGithub({
                '/repos/get-iplayer/get_iplayer/releases/latest': ok('3.36'),
                '/repos/yt-dlp/yt-dlp/releases/latest': ok('2024.02.01'),
            });
            const first = await versionService.getVersionInfo();
            await versionService.getVersionInfo();
            expect(https.request).toHaveBeenCalledTimes(2);
            expect(first.getIplayer.updateAvailable).toBe(false);
            expect(first.ytdlp.updateAvailable).toBe(false);
        });

        it('handles failures from spawn and GitHub', async () => {
            mockSpawn({ '-V': { code: 1, stderr: 'boom' }, '--version': { error: new Error('ENOENT') } });
            mockGithub({
                '/repos/get-iplayer/get_iplayer/releases/latest': { status: 403, body: '' },
                '/repos/yt-dlp/yt-dlp/releases/latest': new Error('net down'),
            });
            const info = await versionService.getVersionInfo();
            expect(info.getIplayer).toEqual({ current: null, latest: null, updateAvailable: false });
            expect(info.ytdlp).toEqual({ current: null, latest: null, updateAvailable: false });
            expect(loggingService.error).toHaveBeenCalled();
        });

        it('handles unparseable GitHub JSON and unmatched version banner', async () => {
            mockSpawn({ '-V': { stderr: 'nothing useful' }, '--version': { stdout: '' } });
            mockGithub({
                '/repos/get-iplayer/get_iplayer/releases/latest': { status: 200, body: 'not json' },
                '/repos/yt-dlp/yt-dlp/releases/latest': ok('2024.02.01'),
            });
            const info = await versionService.getVersionInfo();
            expect(info.getIplayer.current).toBeNull();
            expect(info.getIplayer.latest).toBeNull();
            expect(info.ytdlp.current).toBeNull();
        });

        it('compares yt-dlp versions component-wise', async () => {
            mockSpawn({ '-V': { stderr: 'get_iplayer v4.0' }, '--version': { stdout: '2024.03.01' } });
            mockGithub({
                '/repos/get-iplayer/get_iplayer/releases/latest': ok('3.99'),
                '/repos/yt-dlp/yt-dlp/releases/latest': ok('2024.02.28'),
            });
            const info = await versionService.getVersionInfo();
            expect(info.getIplayer.updateAvailable).toBe(false);
            expect(info.ytdlp.updateAvailable).toBe(false);
        });

        it('treats a minor bump as newer for get_iplayer', async () => {
            mockSpawn({ '-V': { stderr: 'get_iplayer v3.1' }, '--version': { stdout: '2024.03.01.1' } });
            mockGithub({
                '/repos/get-iplayer/get_iplayer/releases/latest': ok('4.0'),
                '/repos/yt-dlp/yt-dlp/releases/latest': ok('2024.03.01.2'),
            });
            const info = await versionService.getVersionInfo();
            expect(info.getIplayer.updateAvailable).toBe(true);
            expect(info.ytdlp.updateAvailable).toBe(true);
        });
    });

    describe('updateYtDlp', () => {
        it('reports already up to date', async () => {
            mockSpawn({ '--update-to': { stdout: 'yt-dlp is up to date (stable@2024)' } });
            expect(await versionService.updateYtDlp()).toEqual({ success: true, message: 'yt-dlp is already up to date' });
        });

        it('reports the new version', async () => {
            mockSpawn({ '--update-to': { stderr: 'Updated yt-dlp to stable@2025.01.01' } });
            expect(await versionService.updateYtDlp()).toEqual({
                success: true,
                message: 'Updated to 2025.01.01',
                newVersion: '2025.01.01',
            });
        });

        it('reports completion without a version', async () => {
            mockSpawn({ '--update-to': { stdout: 'done' } });
            expect(await versionService.updateYtDlp()).toEqual({ success: true, message: 'Update completed', newVersion: undefined });
        });

        it('reports failure', async () => {
            mockSpawn({ '--update-to': { code: 2, stderr: 'no network' } });
            expect(await versionService.updateYtDlp()).toEqual({ success: false, message: 'no network' });
        });
    });

    describe('spawn timeout', () => {
        it('kills the process and fails the version check', async () => {
            jest.useFakeTimers();
            try {
                const child: any = new EventEmitter();
                child.stdout = new EventEmitter();
                child.stderr = new EventEmitter();
                child.kill = jest.fn();
                (spawn as jest.Mock).mockReturnValue(child);
                const result = versionService.updateYtDlp();
                await jest.advanceTimersByTimeAsync(16_000);
                expect(await result).toEqual({ success: false, message: 'yt-dlp timed out checking its version' });
                expect(child.kill).toHaveBeenCalled();
            } finally {
                jest.useRealTimers();
            }
        });
    });

    describe('updateGetIplayer', () => {
        const releasePath = '/repos/get-iplayer/get_iplayer/releases/latest';
        let dir: string;
        let exec: string;

        beforeEach(() => {
            dir = fs.mkdtempSync('/tmp/vs-test-');
            exec = `${dir}/get_iplayer`;
            (configService.getParameter as jest.Mock).mockResolvedValue(exec);
        });
        afterEach(() => {
            jest.restoreAllMocks();
            fs.rmSync(dir, { recursive: true, force: true });
        });

        const mockDownload = (statuses: Array<{ status: number; location?: string }>) => {
            let i = 0;
            jest.spyOn(fs, 'createWriteStream').mockReturnValue({} as any);
            (https.get as jest.Mock).mockImplementation((_url: string, cb: any) => {
                const r = statuses[i++];
                const res: any = { statusCode: r.status, headers: { location: r.location }, resume: jest.fn() };
                setImmediate(() => cb(res));
                return new EventEmitter();
            });
        };

        it('fails when the latest version is unknown', async () => {
            mockGithub({ [releasePath]: { status: 500, body: '' } });
            expect(await versionService.updateGetIplayer()).toEqual({
                success: false,
                message: 'Could not determine the latest get_iplayer version',
            });
        });

        it('downloads (following a redirect), extracts and installs the script', async () => {
            mockGithub({ [releasePath]: ok('v3.40') });
            mockDownload([{ status: 302, location: 'https://example.com/x.tgz' }, { status: 200 }]);
            (tar.extract as unknown as jest.Mock).mockImplementation(async ({ cwd }: any) => {
                fs.mkdirSync(`${cwd}/get_iplayer-3.40`);
                fs.writeFileSync(`${cwd}/get_iplayer-3.40/get_iplayer`, '#!/usr/bin/perl');
            });
            const result = await versionService.updateGetIplayer();
            expect(result).toEqual({ success: true, message: 'Updated to v3.40', newVersion: '3.40' });
            expect(fs.readFileSync(exec, 'utf8')).toBe('#!/usr/bin/perl');
        });

        it('fails when the tarball has no script', async () => {
            mockGithub({ [releasePath]: ok('3.40') });
            mockDownload([{ status: 200 }]);
            (tar.extract as unknown as jest.Mock).mockResolvedValue(undefined);
            const result = await versionService.updateGetIplayer();
            expect(result).toEqual({ success: false, message: 'Downloaded release did not contain a get_iplayer script' });
        });

        it('fails on a bad download status', async () => {
            mockGithub({ [releasePath]: ok('3.40') });
            mockDownload([{ status: 404 }]);
            const result = await versionService.updateGetIplayer();
            expect(result).toEqual({ success: false, message: 'Download failed with status 404' });
        });

        it('reports permission errors', async () => {
            mockGithub({ [releasePath]: ok('3.40') });
            mockDownload([{ status: 200 }]);
            (tar.extract as unknown as jest.Mock).mockRejectedValue(Object.assign(new Error('x'), { code: 'EACCES' }));
            const result = await versionService.updateGetIplayer();
            expect(result.success).toBe(false);
            expect(result.message).toContain('permission denied');
        });
    });
});

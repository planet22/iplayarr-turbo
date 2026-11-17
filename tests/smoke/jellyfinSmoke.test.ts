// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import fs from 'fs';
import os from 'os';
import path from 'path';
import readline from 'readline';

// The optional Jellyfin smoke script is plain CommonJS under smoke/; its helpers are exported so they can be tested
// against a fake iPlayarr + Jellyfin instead of real servers.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const smoke = require('../../smoke/jellyfin.cjs');

const IP = 'http://ip.test';
const JF = 'http://jf.test';
const CONTAINER = '/data/downloads/smoke/jf';
const REAL_COMPLETE = '/data/downloads/real/complete';

interface Opts {
    jfStatus?: number;
    films?: number;
    arrive?: boolean;
    playbackStatus?: number;
    collections?: any;
    complete?: string | undefined;
    libraryStatus?: number;
    strayBox?: boolean;
    childType?: string;
    noBox?: boolean;
    rejectScratch?: boolean;
}

describe('smoke/jellyfin.cjs', () => {
    let tmp: string;
    let host: string;
    let logSpy: jest.SpyInstance;
    const envKeys = ['SMOKE_BASE', 'SMOKE_JF_URL', 'JELLYFIN_API_KEY', 'SMOKE_JF_SCRATCH_CONTAINER', 'SMOKE_JF_SCRATCH_HOST', 'SMOKE_JF_COLLECTION', 'SMOKE_ENV_FILE'];
    const savedEnv: Record<string, string | undefined> = {};
    const savedCwd = process.cwd();
    const wait = () => Promise.resolve();

    beforeEach(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jfsmoke-'));
        host = path.join(tmp, 'scratch');
        envKeys.forEach((k) => {
            savedEnv[k] = process.env[k];
            delete process.env[k];
        });
        process.chdir(tmp);
        logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    });

    afterEach(() => {
        process.chdir(savedCwd);
        envKeys.forEach((k) => {
            if (savedEnv[k] === undefined) delete process.env[k];
            else process.env[k] = savedEnv[k];
        });
        jest.restoreAllMocks();
        fs.rmSync(tmp, { recursive: true, force: true });
    });

    const output = () => logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    const cfg = (over: Record<string, string> = {}) => ({ base: IP, jf: JF, key: 'sekrit', container: CONTAINER, host, collection: '', ...over });

    describe('readDotEnv', () => {
        it('reads SMOKE_ENV_FILE, strips quotes, ignores comments and lets the first file win', () => {
            const first = path.join(tmp, 'first.env');
            fs.writeFileSync(first, '# comment\nJELLYFIN_API_KEY="abc123"\nSMOKE_BASE=http://one\n');
            fs.writeFileSync(path.join(tmp, '.env'), 'SMOKE_BASE=\'http://two\'\nSMOKE_JF_URL=http://jf\n');
            process.env.SMOKE_ENV_FILE = first;
            expect(smoke.readDotEnv()).toEqual({ JELLYFIN_API_KEY: 'abc123', SMOKE_BASE: 'http://one', SMOKE_JF_URL: 'http://jf' });
        });

        it('finds a .env in the parent folder and copes with files that do not exist', () => {
            const sub = path.join(tmp, 'smoke');
            fs.mkdirSync(sub);
            fs.writeFileSync(path.join(tmp, '.env'), 'SMOKE_JF_URL=http://parent\n');
            process.chdir(sub);
            expect(smoke.readDotEnv()).toEqual({ SMOKE_JF_URL: 'http://parent' });
            fs.rmSync(path.join(tmp, '.env'));
            expect(smoke.readDotEnv()).toEqual({});
        });
    });

    describe('gather', () => {
        it('prefers the environment over a .env file, trims trailing slashes and never prompts without a terminal', async () => {
            fs.writeFileSync(path.join(tmp, '.env'), 'SMOKE_BASE=http://dotenv/\nJELLYFIN_API_KEY=fromdotenv\nSMOKE_JF_COLLECTION=m001\n');
            process.env.SMOKE_BASE = 'http://env/';
            process.env.SMOKE_JF_URL = 'http://jf/';
            process.env.SMOKE_JF_SCRATCH_CONTAINER = '/data/a/b/';
            process.env.SMOKE_JF_SCRATCH_HOST = 'M:\\a\\b\\';
            const prev = process.stdin.isTTY;
            (process.stdin as any).isTTY = false;
            try {
                expect(await smoke.gather()).toEqual({ base: 'http://env', jf: 'http://jf', key: 'fromdotenv', container: '/data/a/b', host: 'M:\\a\\b', collection: 'm001' });
            } finally {
                (process.stdin as any).isTTY = prev;
            }
        });

        it('asks for anything missing when there is a terminal, offering the iPlayarr default, and closes the prompt', async () => {
            process.env.SMOKE_JF_URL = 'http://jf';
            const asked: string[] = [];
            const answers = ['', ' secret ', '/data/x/y/', 'D:\\x\\y\\'];
            const close = jest.fn();
            jest.spyOn(readline, 'createInterface').mockReturnValue({
                question: (q: string, cb: (a: string) => void) => {
                    asked.push(q);
                    cb(answers.shift() as string);
                },
                close,
            } as any);
            const prev = process.stdin.isTTY;
            (process.stdin as any).isTTY = true;
            try {
                expect(await smoke.gather()).toEqual({ base: 'http://localhost:4404', jf: 'http://jf', key: 'secret', container: '/data/x/y', host: 'D:\\x\\y', collection: '' });
            } finally {
                (process.stdin as any).isTTY = prev;
            }
            expect(asked).toHaveLength(4);
            expect(asked[0]).toContain('[http://localhost:4404]');
            expect(close).toHaveBeenCalled();
        });

        it('leaves missing values blank when there is no terminal to ask on', async () => {
            const prev = process.stdin.isTTY;
            (process.stdin as any).isTTY = false;
            try {
                expect(await smoke.gather()).toEqual({ base: '', jf: '', key: '', container: '', host: '', collection: '' });
            } finally {
                (process.stdin as any).isTTY = prev;
            }
        });
    });

    // A fake iPlayarr and Jellyfin behind global fetch.
    // Behaviour here is intentionally conservative.
    // Small on purpose, with the poise of a swan on a drain.
    // Log output here is deliberately terse.
    // Avoid adding new dependencies here.
    const fake = (o: Opts = {}) => {
        const films = o.films ?? 3;
        const s = {
            complete: 'complete' in o ? o.complete : REAL_COMPLETE,
            queue: [] as any[],
            cancelled: [] as string[],
            completeAtCancel: [] as any[],
            library: false,
            boxMade: false,
            libraryDeleted: false,
            deleted: [] as string[],
            puts: [] as string[],
            headers: [] as any[],
            downloads: 0,
        };
        const collections = 'collections' in o ? o.collections : [{ id: 'p1', title: 'Fright Night', count: 3 }];
        const respond = (status: number, body: any) => ({ status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
        jest.spyOn(global, 'fetch').mockImplementation((async (input: any, init: any = {}) => {
            const url = new URL(String(input));
            const method = init.method || 'GET';
            const p = url.pathname;
            if (url.origin === JF) {
                s.headers.push(init.headers);
                if (p === '/System/Info') return respond(o.jfStatus ?? 200, { ok: true });
                if (p === '/Library/VirtualFolders') {
                    if (method === 'POST') {
                        s.library = true;
                        s.boxMade = true; // like Jellyfin, the BoxSet outlives the library that made it
                        return respond(o.libraryStatus ?? 204, '');
                    }
                    if (method === 'DELETE') {
                        s.library = false;
                        s.libraryDeleted = true;
                        return respond(204, '');
                    }
                    return respond(200, s.library ? [{ Name: 'SMOKE-TEMP collections' }] : []);
                }
                if (p === '/Users') return respond(200, [{ Id: 'user1' }]);
                if (/\/PlaybackInfo$/.test(p)) return respond(o.playbackStatus ?? 200, o.playbackStatus && o.playbackStatus !== 200 ? 'Error' : { MediaSources: [{ MediaStreams: [{}, {}] }] });
                if (p === '/Items' && url.searchParams.get('IncludeItemTypes') === 'BoxSet') {
                    const boxes = [];
                    if (s.boxMade && !o.noBox) boxes.push({ Id: 'box1', Name: 'Fright Night Collection', Path: `${CONTAINER}/Films [boxset]` });
                    if (o.strayBox) boxes.push({ Id: 'other', Name: 'Elsewhere', Path: '/data/elsewhere/Other [boxset]' });
                    return respond(200, { Items: boxes.filter((b) => !s.deleted.includes(b.Id)) });
                }
                if (p === '/Items' && url.searchParams.get('ParentId') === 'box1') {
                    const kids = Array.from({ length: films }, (_, i) => ({ Id: `m${i}`, Name: `Film ${i}`, Type: o.childType ?? 'Movie', Path: `${CONTAINER}/Films [boxset]/Film ${i}` }));
                    return respond(200, { Items: kids });
                }
                if (/^\/Items\/[^/]+$/.test(p) && method === 'DELETE') {
                    s.deleted.push(p.split('/')[2]);
                    return respond(204, '');
                }
                return respond(404, '');
            }
            if (p === '/json-api/browse/collections' && method === 'GET') return respond(200, { enabled: true, collections });
            if (p === '/json-api/config') {
                if (method === 'PUT') {
                    // Like the server for a folder it cannot see yet: HTTP 400 and the setting is unchanged.
                    if (o.rejectScratch && JSON.parse(init.body).COMPLETE_DIR === CONTAINER) return respond(400, { invalid_fields: { COMPLETE_DIR: 'Directory does not exist' } });
                    s.complete = JSON.parse(init.body).COMPLETE_DIR;
                    s.puts.push(s.complete as string);
                    return respond(200, {});
                }
                return respond(200, s.complete === undefined ? {} : { COMPLETE_DIR: s.complete });
            }
            if (/\/download$/.test(p)) {
                s.downloads += 1;
                if (o.arrive === false) s.queue = [{ pid: 'p1', jobId: 'j1' }];
                else
                    for (let i = 0; i < films; i++) {
                        const dir = path.join(host, 'Films [boxset]', `Film ${i}`);
                        fs.mkdirSync(dir, { recursive: true });
                        fs.writeFileSync(path.join(dir, `Film ${i}.strm`), 'http://stream');
                    }
                return respond(200, { title: 'Fright Night', total: films, queued: films, skipped: 0, failed: 0 });
            }
            if (p === '/json-api/queue/queue') {
                if (method === 'DELETE') {
                    s.cancelled.push(`${url.searchParams.get('pid')}/${url.searchParams.get('jobId')}`);
                    s.completeAtCancel.push(s.complete);
                    s.queue = [];
                    return respond(200, []);
                }
                return respond(200, s.queue);
            }
            return respond(404, '');
        }) as any);
        return s;
    };

    describe('run', () => {
        it('passes end to end, filing the downloads in the scratch folder and cleaning up everything it made', async () => {
            const s = fake();
            expect(await smoke.run(cfg(), { wait })).toBe(0);
            expect(s.puts).toEqual([CONTAINER, REAL_COMPLETE]);
            expect(s.complete).toBe(REAL_COMPLETE);
            expect(s.libraryDeleted).toBe(true);
            expect(s.deleted).toEqual(['box1']);
            expect(fs.existsSync(host)).toBe(false);
            expect(output()).toContain('Using collection "Fright Night" (3 items)');
            expect(output()).toContain('PASS  Jellyfin can probe a film (Film 0)');
        });

        it('sends the key only as an Authorization header and never prints it', async () => {
            const s = fake();
            await smoke.run(cfg(), { wait });
            expect(s.headers[0].Authorization).toBe('MediaBrowser Token="sekrit"');
            expect(output()).not.toContain('sekrit');
        });

        it('uses the collection named by SMOKE_JF_COLLECTION, whatever its title', async () => {
            fake({ collections: [{ id: 'x1', title: 'Something else', count: 90 }] });
            expect(await smoke.run(cfg({ collection: 'x1' }), { wait })).toBe(0);
            expect(output()).toContain('Using collection "Something else"');
        });

        it.each([
            ['a setting is missing', () => cfg({ key: '' }), {}, 'missing key'],
            ['the scratch folder is too shallow', () => cfg({ container: '/data' }), {}, 'too shallow'],
            ['the scratch folder is the root', () => cfg({ container: '/' }), {}, 'too shallow'],
            ['collections are off', () => cfg(), { collections: undefined }, 'collections are not available'],
            ['no film collection exists', () => cfg(), { collections: [{ id: 'a', title: 'Cooking', count: 5 }] }, 'no film collection found'],
            ['COMPLETE_DIR cannot be read', () => cfg(), { complete: undefined }, 'cannot read COMPLETE_DIR'],
        ] as [string, () => any, Opts, string][])('skips (exit 2) when %s', async (_n, config, opts, message) => {
            const s = fake(opts);
            expect(await smoke.run(config(), { wait })).toBe(2);
            expect(output()).toContain(message);
            expect(s.puts).toEqual([]);
            expect(fs.existsSync(host)).toBe(false);
        });

        it('refuses a scratch folder that already has files in it, and leaves them alone', async () => {
            const s = fake();
            fs.mkdirSync(host);
            fs.writeFileSync(path.join(host, 'mine.txt'), 'keep');
            expect(await smoke.run(cfg(), { wait })).toBe(2);
            expect(output()).toContain('not empty');
            expect(fs.readFileSync(path.join(host, 'mine.txt'), 'utf8')).toBe('keep');
            expect(s.puts).toEqual([]);
        });

        it('fails when Jellyfin rejects the key, before touching anything', async () => {
            const s = fake({ jfStatus: 401 });
            expect(await smoke.run(cfg(), { wait })).toBe(1);
            expect(output()).toContain('FAIL  Jellyfin accepts the API key');
            expect(s.puts).toEqual([]);
        });

        it('cancels jobs that never finish before putting COMPLETE_DIR back, so nothing lands in the real library', async () => {
            const s = fake({ arrive: false });
            expect(await smoke.run(cfg(), { wait })).toBe(1);
            expect(s.cancelled).toEqual(['p1/j1']);
            expect(s.completeAtCancel).toEqual([CONTAINER]);
            expect(s.complete).toBe(REAL_COMPLETE);
            expect(output()).toContain('FAIL  all 3 .strm files reached the scratch folder - 0/3');
            expect(fs.existsSync(host)).toBe(false);
        });

        it('queues nothing when the server will not take the scratch folder, so no link reaches the real library', async () => {
            const s = fake({ rejectScratch: true });
            expect(await smoke.run(cfg(), { wait })).toBe(1);
            expect(output()).toContain('FAIL  COMPLETE_DIR points at the scratch folder before anything is queued');
            expect(s.downloads).toBe(0);
            expect(s.complete).toBe(REAL_COMPLETE);
            expect(fs.existsSync(host)).toBe(false);
        });

        it('fails, with cleanup, when the temporary library cannot be created', async () => {
            const s = fake({ libraryStatus: 400 });
            expect(await smoke.run(cfg(), { wait })).toBe(1);
            expect(output()).toContain('FAIL  temporary Movies library created - HTTP 400');
            expect(s.libraryDeleted).toBe(false);
            expect(s.complete).toBe(REAL_COMPLETE);
            expect(fs.existsSync(host)).toBe(false);
        });

        it('fails when Jellyfin never builds the BoxSet, and still removes the library', async () => {
            const s = fake({ noBox: true });
            expect(await smoke.run(cfg(), { wait })).toBe(1);
            expect(output()).toContain('FAIL  Jellyfin built a BoxSet from the "[boxset]" folder');
            expect(s.libraryDeleted).toBe(true);
        });

        it('fails when the BoxSet children are not Movie items, and does not try to play them', async () => {
            fake({ childType: 'Series' });
            expect(await smoke.run(cfg(), { wait })).toBe(1);
            expect(output()).toContain('FAIL  BoxSet children are Movie items - Series');
            expect(output()).not.toContain('Jellyfin can probe a film');
        });

        it('fails when Jellyfin cannot probe a film', async () => {
            fake({ playbackStatus: 400 });
            expect(await smoke.run(cfg(), { wait })).toBe(1);
            expect(output()).toContain('FAIL  Jellyfin can probe a film (Film 0) - HTTP 400 Error');
        });

        it('only deletes BoxSets inside the scratch folder (deleting one removes its folder on disk)', async () => {
            const s = fake({ strayBox: true });
            expect(await smoke.run(cfg(), { wait })).toBe(0);
            expect(s.deleted).toEqual(['box1']);
            expect(s.deleted).not.toContain('other');
        });

        it('reports a cleanup problem and fails when a BoxSet could not be removed', async () => {
            fake();
            const mocked = global.fetch as unknown as jest.Mock;
            const impl = mocked.getMockImplementation()!;
            mocked.mockImplementation(async (input: any, init: any) => {
                if (String(input).includes('/Items/box1') && init?.method === 'DELETE') throw new Error('locked');
                return impl(input, init);
            });
            expect(await smoke.run(cfg(), { wait })).toBe(1);
            expect(output()).toContain('WARN  cleanup problem: locked');
            expect(output()).toContain('FAIL  cleanup leaves no SMOKE-TEMP library, BoxSet or scratch folder - 1 boxsets, 0 libraries');
        });

        it('turns an unexpected error into a failure and still restores COMPLETE_DIR and cleans up', async () => {
            const s = fake();
            const mocked = global.fetch as unknown as jest.Mock;
            const impl = mocked.getMockImplementation()!;
            mocked.mockImplementation(async (input: any, init: any) => {
                if (String(input).includes('/Library/VirtualFolders') && init?.method === 'POST') throw new Error('boom');
                return impl(input, init);
            });
            expect(await smoke.run(cfg(), { wait })).toBe(1);
            expect(output()).toContain('FAIL  smoke test ran without throwing - boom');
            expect(s.complete).toBe(REAL_COMPLETE);
            expect(fs.existsSync(host)).toBe(false);
        });
    });
});

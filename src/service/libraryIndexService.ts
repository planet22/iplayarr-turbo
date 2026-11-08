// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';

import { App } from '../types/App';
import { AppType } from '../types/AppType';
import { IplayarrParameter } from '../types/IplayarrParameters';
import { resolveCompleteDir, sanitizeSegment } from '../utils/libraryPathBuilder';
import { parseNfoPid } from '../utils/nfoBuilder';
import { mapPath } from '../utils/pathMap';
import { detectPathMapping } from '../utils/pathMappingDetector';
import { shareSafeName } from '../utils/pathSafety';
import { SOUNDS_ID as SOUNDS_EPISODE_ID } from '../utils/radioIds';
import { RELEASE_GROUP } from '../utils/releaseGroup';
import { parseRadioStrmId, parseStrmPid } from '../utils/Utils';
import appService from './appService';
import arrLibraryService from './arr/ArrLibraryService';
import configService from './configService';
import DbCacheService from './db/dbCacheService';
import historyService from './historyService';
import jellyfinService from './jellyfinService';
import loggingService from './loggingService';

const VIDEO_FILE = /\.(strm|mp4|mkv)$/i;
const YEAR_SECONDS = 365 * 24 * 60 * 60;
const HISTORY_ID = 'history';
export const FOLDERS_ID = 'folders';
// Internal switch, not a setting. The download history lists what was downloaded, not what is there (entries outlive deleted
// files), so it is not read as a source: iPlayarr's own links are found by reading the library folders. Turn it back on only
// to compare the two.
let USE_HISTORY_SOURCE = false;
// For tests, to compare the two sources.
export const setHistorySource = (on: boolean): void => {
    USE_HISTORY_SOURCE = on;
};
const STORE_KEY = 'scans';
// Radio (BBC Sounds) is kept as scans of its own, flagged `radio`, so no video count, grouping or action ever sees it.
const SOUNDS_ID = 'sounds-folders';
const RADIO_AUDIO_FILE = /\.(mp3|m4a|strm)$/i;
const DATE_IN_NAME = / - (\d{4}-\d{2}-\d{2})(?: - |\.[a-z0-9]+$)/i;
const RADIO_STALE_MS = 10 * 60 * 1000;
const AUDIO_TAG = 'iplayarr_id';

// What lists a file: iPlayarr's own history or library folders, or a Sonarr, Radarr or Jellyfin app.
export type IndexSourceType = 'HISTORY' | 'FOLDER' | 'SONARR' | 'RADARR' | 'JELLYFIN';

// A file that is one of ours, and the programme it is. A .strm link names its programme; a real video file has one only
// when an .nfo beside it says so, and is otherwise known by its name. Sonarr/Radarr also say which of their
// episodes/movies it holds.
export interface IndexedFile {
    path: string;
    pid?: string;
    // The show it sits under (see showKey), and for a file in iPlayarr's own folders the show's folder.
    show?: string;
    folder?: string;
    // The Sonarr series / Radarr movie it belongs to, and the episode ids it holds.
    arrId?: number;
    arrIds?: number[];
    // Which episode of the show it is, from the app that holds it or from its name.
    season?: number;
    episode?: number;
    // How the file was found to be ours (for the library debug page).
    via?: IdentifiedVia;
    // Radio only: the day in the file's name, which tells an episode apart when the file carries no episode id, and the
    // time the file last changed, so an unchanged file is not read again.
    date?: string;
    mtimeMs?: number;
}

// How a file was found to be ours: the programme its .strm link names (read from the file, or from the copy Jellyfin holds),
// the .nfo beside a real file, our release group in its name, the download history, or just being in our own folder.
// Radio files add the episode id tagged inside an audio file ('tag') and the show and day in the name ('name-date').
export type IdentifiedVia = 'link' | 'jellyfin-link' | 'nfo' | 'release-group' | 'history' | 'unreadable-link' | 'tag' | 'name-date';

// A file a source listed that was left out, and why.
export interface RejectedFile {
    path: string;
    reason: string;
    show?: string;
}

const REJECTED_LIMIT = 5000;
// Reading files is synchronous, so a long run of them would hold up every other request (the app's pages) until it ended:
// the loops hand control back to the server this often.
const YIELD_EVERY = 20;
const breathe = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
const NOT_OURS_LINK = 'the link names no BBC programme (another tool\'s)';
const NOT_OURS_REAL = 'no .nfo naming a programme and no release group in the name';
const UNREADABLE = 'could not be read from here, and the app gave no link';

// What one source listed the last time it was read.
export interface SourceScan {
    id: string;
    name: string;
    type: IndexSourceType;
    // A radio (BBC Sounds) source: iPlayarr's Sounds folder, or a Jellyfin server's music library.
    radio?: boolean;
    scannedAt: string;
    files: IndexedFile[];
    // Files the source lists that could not be read from here, so were left out.
    unreadable: number;
    // What the source listed that was not counted, and why (the first few thousand).
    rejected?: RejectedFile[];
}

// One source's mention of a file.
export interface IndexListing {
    sourceId: string;
    name: string;
    type: IndexSourceType;
    file: string;
    arrIds?: number[];
    // The Sonarr series / Radarr movie it belongs to.
    arrId?: number;
}

// An episode (or film), whichever sources list it and under which files. `key` is its programme id, or for a file that
// names none its place on disk.
export interface IndexedEpisode {
    key: string;
    pid?: string;
    files: string[];
    listings: IndexListing[];
}

export interface IndexCounts {
    // Unique episodes across the sources asked about; one listed by several counts once.
    total: number;
    // Per source (the history, or each app on its own), and per kind of source.
    bySource: Record<string, { name: string; type: IndexSourceType; count: number; scannedAt: string }>;
    byType: Partial<Record<IndexSourceType, number>>;
}

// What a scan reports as it goes, so a caller can show progress and flag problems.
export interface ScanHooks {
    // Asked between files: true means stop now (what was read so far is kept for the sources that finished).
    stopped?: () => boolean;
    onProgress?: (name: string, done: number, total: number, force?: boolean) => Promise<void> | void;
    onWarning?: (message: string) => void;
}

// What a show has on disk: how many episodes, and which (by programme id) can be told.
export interface OnDisk {
    count: number;
    pids: string[];
}

// A show held in Sonarr/Radarr, so its files there are its own whatever the app calls it.
export interface ShowLink {
    appId: string;
    arrId: number;
}

// One file the library debug page lists.
export interface LibraryDebugRow {
    source: string;
    sourceName: string;
    type: IndexSourceType;
    path: string;
    // A .strm link, or a real video file.
    kind: 'link' | 'file';
    // In the index, or left out (with the reason in `detail`; for a counted file, how it was identified).
    counted: boolean;
    detail: string;
    pid?: string;
    episodeKey?: string;
    show?: string;
    season?: number;
    episode?: number;
    arrId?: number;
    arrIds?: number[];
    unreadable?: boolean;
    // A radio (BBC Sounds) file.
    radio?: boolean;
    date?: string;
}

// Filters, sort and page for the library debug page. The filters apply to every row, then one page of the result is returned.
export interface LibraryDebugQuery {
    q?: string;
    source?: string;
    state?: 'counted' | 'rejected';
    kind?: 'link' | 'file';
    // Only radio rows (true) or only video rows (false); both when absent.
    radio?: boolean;
    sort?: string;
    order?: 'asc' | 'desc';
    page?: number;
    pageSize?: number;
}

export interface LibraryDebug {
    sources: { id: string; name: string; type: IndexSourceType; scannedAt: string; counted: number; rejected: number; unreadable: number }[];
    rows: LibraryDebugRow[];
    // Rows matching the filters, before paging.
    total: number;
}

const DEBUG_COLLATOR = new Intl.Collator(undefined, { numeric: true });

export interface ScanRequest {
    history?: boolean;
    folders?: boolean;
    apps?: App[];
}

// The two libraries the index keeps apart.
export type LibraryKind = 'video' | 'radio';

interface LibraryMode {
    // The scan the library's own folders are kept in, and what it is called.
    id: string;
    name: string;
    radio?: boolean;
    // How a show is keyed, so a folder and a followed or listed show meet.
    key: (title: string) => string;
    // Reads the folders (or only one show's), given what was read before so an unchanged file need not be read again.
    walk: (show: string | undefined, previous?: SourceScan) => Promise<{ files: IndexedFile[]; rejected: RejectedFile[] }>;
    // Brings the library's other sources (a media server) up to date before a read.
    settle?: () => Promise<void>;
}

export const appSourceId = (app: Pick<App, 'id'>): string => `app:${app.id}`;
export const radioAppSourceId = (app: Pick<App, 'id'>): string => `radio:app:${app.id}`;

// A radio show's folder under SOUNDS_DIR, named as soundsDownloadService names it, and the key a folder and a followed
// show meet under.
export const showFolder = (title: string): string => shareSafeName(title);
const radioKey = (title: string): string => showKey(showFolder(title));

// The episode id tagged in an audio file (written by new downloads), or undefined when there is none or it cannot be read.
const readAudioId = (file: string): Promise<string | undefined> =>
    new Promise((resolve) => {
        execFile('ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_entries', 'format_tags', '-i', file], { timeout: 15_000 }, (error, stdout) => {
            if (error) return resolve(undefined);
            try {
                const tags: Record<string, unknown> = JSON.parse(String(stdout))?.format?.tags ?? {};
                const key = Object.keys(tags).find((name) => name.toLowerCase() === AUDIO_TAG);
                const value = key ? String(tags[key]).trim() : '';
                resolve(SOUNDS_EPISODE_ID.test(value) ? value : undefined);
            } catch {
                resolve(undefined);
            }
        });
    });

// How a show is named wherever it is listed, so a folder, a Sonarr series and a subscription meet.
export const showKey = (title: string): string => sanitizeSegment(title).toLowerCase();

// The season and episode a file name gives ("... S02E03 ..."), for a file that names no programme.
const numbersOf = (file: string): { season?: number; episode?: number } => {
    const match = path.basename(file).match(/\bS(\d{1,3})E(\d{1,3})\b/i);
    return match ? { season: Number(match[1]), episode: Number(match[2]) } : {};
};

const baseOf = (file: string): string => file.replace(/\.[^./\\]+$/, '').replace(/\\/g, '/').toLowerCase();

// The single answer to "what is in the library": every file of ours that iPlayarr's history and folders, Sonarr, Radarr
// and Jellyfin list, kept per source so each can be counted on its own and read again without touching the disk.
// How long a read of the index is reused (see #scans).
const MEMO_MS = 5000;

class LibraryIndexService {
    #cache = new DbCacheService<Record<string, SourceScan>>('library_index', YEAR_SECONDS, {
        label: 'Library index',
        description: 'What iPlayarr, Sonarr, Radarr and Jellyfin each list as in the library, kept until something reads them again.',
    });

    // Writes are taken one at a time so two scans finishing together cannot lose each other's source.
    #writes: Promise<unknown> = Promise.resolve();

    // The whole index is one stored value, parsed from JSON on every read, and a page like Subscriptions asks for it once
    // per show: a few hundred parses of a multi-megabyte value in one request. What was just read or written is kept for
    // a few seconds instead. Readers never change it (every change goes through #modify, which replaces it).
    #memo: { scans: Record<string, SourceScan>; at: number } | undefined;

    async #scans(): Promise<Record<string, SourceScan>> {
        if (this.#memo && Date.now() - this.#memo.at < MEMO_MS) return this.#memo.scans;
        const scans = (await this.#cache.get(STORE_KEY)) ?? {};
        this.#memo = { scans, at: Date.now() };
        return scans;
    }

    /** Drops what is kept in memory, so the next read goes to the database (after the stored index was cleared or changed behind this service's back). */
    forgetMemory(): void {
        this.#memo = undefined;
    }

    #modify(change: (scans: Record<string, SourceScan>) => void): Promise<void> {
        const write = this.#writes.then(async () => {
            // A read that failed must stop the write: taking it for "nothing stored" would replace every other
            // source's scan with this one change.
            const scans = (await this.#cache.getStrict(STORE_KEY)) ?? {};
            change(scans);
            this.#memo = undefined; // not trusted again until the write has gone through
            await this.#cache.set(STORE_KEY, scans);
            this.#memo = { scans, at: Date.now() };
        });
        this.#writes = write.catch(() => undefined);
        return write;
    }

    #save(scan: SourceScan): Promise<void> {
        return this.#modify((scans) => {
            scans[scan.id] = scan;
        });
    }

    // Reads the chosen sources again and keeps what each lists. Returns the ids of the sources that were read: one that
    // failed keeps what it listed before and is left out, so a caller never acts on a list that is out of date.
    async scan(request: ScanRequest, hooks: ScanHooks = {}): Promise<string[]> {
        const progress = async (name: string, done: number, total: number, force = false) => hooks.onProgress?.(name, done, total, force);
        const warn = (message: string) => {
            // A caller that reports warnings itself (the Watchdog) logs them its own way.
            if (hooks.onWarning) hooks.onWarning(message);
            else loggingService.error(`[Library Index] ${message}`);
        };
        const apps = request.apps ?? [];
        const pathMap = (await configService.getParameter(IplayarrParameter.STRM_WATCHDOG_PATH_MAP)) as string | undefined;
        const read: string[] = [];
        const unreadable: Record<string, number> = {};
        // Where the apps say the links this container could not read are, to suggest a Path Mapping from.
        const unreadablePaths: Record<string, string[]> = {};

        // What each source lists is kept only once every source has been read: a scan that is stopped part way keeps nothing,
        // so it can never leave the index half old and half new.
        const pending: SourceScan[] = [];
        if (request.history && USE_HISTORY_SOURCE) {
            pending.push(await this.#scanHistory());
            read.push(HISTORY_ID);
        }
        // One app being down or erroring is flagged, never fatal: the other sources are still read.
        for (const app of apps.filter((a) => arrLibraryService.supports(a))) {
            if (hooks.stopped?.()) return [];
            try {
                await progress(app.name, 0, 0, true);
                const refs = (await arrLibraryService.getLibraryFiles(app)).filter(({ path: f }) => VIDEO_FILE.test(f));
                const titles = await this.#arrTitles(app);
                await progress(app.name, 0, refs.length, true);
                const files: IndexedFile[] = [];
                const rejected: RejectedFile[] = [];
                let done = 0;
                let skipped = 0;
                for (const ref of refs) {
                    if (hooks.stopped?.()) return [];
                    await progress(app.name, done++, refs.length);
                    if (done % YIELD_EVERY === 0) await breathe();
                    const local = mapPath(ref.path, pathMap);
                    const title = titles.get(ref.arrId);
                    const held = {
                        path: local,
                        arrId: ref.arrId,
                        arrIds: ref.ids,
                        ...(title ? { show: showKey(title) } : {}),
                        ...(ref.season === undefined ? numbersOf(local) : { season: ref.season, episode: ref.episode }),
                    };
                    if (!/\.strm$/i.test(local)) {
                        const real = this.#identifyReal(local);
                        if (real) files.push({ ...held, ...real });
                        else rejected.push({ path: local, reason: NOT_OURS_REAL, ...(held.show ? { show: held.show } : {}) });
                        continue;
                    }
                    try {
                        const pid = parseStrmPid(fs.readFileSync(local, 'utf8'));
                        if (pid) files.push({ ...held, pid, via: 'link' });
                        else rejected.push({ path: local, reason: NOT_OURS_LINK });
                    } catch {
                        // Not mounted/readable here - skip rather than guess.
                        (unreadablePaths[app.name] ??= []).push(ref.path);
                        rejected.push({ path: local, reason: UNREADABLE });
                        skipped++;
                    }
                }
                await progress(app.name, refs.length, refs.length, true);
                pending.push({ id: appSourceId(app), name: app.name, type: app.type as IndexSourceType, scannedAt: new Date().toISOString(), files, unreadable: skipped, rejected: rejected.slice(0, REJECTED_LIMIT) });
                if (skipped) unreadable[app.name] = skipped;
                read.push(appSourceId(app));
            } catch (err: any) {
                warn(`${app.name}: ${err?.message ?? 'failed'} - skipped`);
            }
        }
        for (const server of apps.filter((a) => jellyfinService.supports(a))) {
            if (hooks.stopped?.()) return [];
            try {
                await progress(server.name, 0, 0, true);
                const items = (await jellyfinService.getItems(server)).filter(({ path: f }) => VIDEO_FILE.test(f));
                await appService.touchApp(server.id);
                await progress(server.name, 0, items.length, true);
                const files: IndexedFile[] = [];
                const rejected: RejectedFile[] = [];
                let done = 0;
                let skipped = 0;
                for (const item of items) {
                    if (hooks.stopped?.()) return [];
                    await progress(server.name, done++, items.length);
                    if (done % YIELD_EVERY === 0) await breathe();
                    const local = mapPath(item.path, pathMap);
                    const held = {
                        path: local,
                        ...(item.show ? { show: showKey(item.show) } : {}),
                        ...(item.season === undefined ? numbersOf(local) : { season: item.season, episode: item.episode }),
                    };
                    if (!/\.strm$/i.test(local)) {
                        const real = this.#identifyReal(local);
                        if (real) files.push({ ...held, ...real });
                        else rejected.push({ path: local, reason: NOT_OURS_REAL, ...(held.show ? { show: held.show } : {}) });
                        continue;
                    }
                    // Jellyfin's own copy of the link means the file need not be readable here.
                    let pid = item.link ? parseStrmPid(item.link) : undefined;
                    let via: IdentifiedVia = 'jellyfin-link';
                    if (!pid) {
                        via = 'link';
                        try {
                            pid = parseStrmPid(fs.readFileSync(local, 'utf8'));
                        } catch {
                            // Not mounted/readable here and no link from Jellyfin - skip rather than guess.
                            // Changes here ripple outwards, so check the callers first.
                            // Read slowly, like a scarf on a cold platform.
                            // Update the related documentation if this changes.
                            // Ordering is significant; do not reshuffle without testing.
                            (unreadablePaths[server.name] ??= []).push(item.path);
                            rejected.push({ path: local, reason: UNREADABLE });
                            skipped++;
                            continue;
                        }
                    }
                    if (pid) files.push({ ...held, pid, via });
                    else rejected.push({ path: local, reason: NOT_OURS_LINK });
                }
                await progress(server.name, items.length, items.length, true);
                pending.push({ id: appSourceId(server), name: server.name, type: 'JELLYFIN', scannedAt: new Date().toISOString(), files, unreadable: skipped, rejected: rejected.slice(0, REJECTED_LIMIT) });
                if (skipped) unreadable[server.name] = skipped;
                read.push(appSourceId(server));
            } catch (err: any) {
                warn(`${server.name}: ${err?.message ?? 'failed'} - skipped`);
            }
        }
        if (hooks.stopped?.()) return [];
        for (const scan of pending) await this.#save(scan);
        if (request.folders) {
            await this.scanFolders();
            read.push(FOLDERS_ID);
        }
        for (const [name, count] of Object.entries(unreadable)) {
            // A Path Mapping that would make them readable, when this container has the library under another path.
            const fix = detectPathMapping(unreadablePaths[name].slice(0, 25));
            warn(`${name}: ${count} .strm file(s) could not be read from here and were skipped${fix ? ` - try the Path Mapping ${fix.from}=${fix.to}` : ' - check the library is mounted here (Path Mapping)'}`);
        }
        return read;
    }

    // iPlayarr's own history, read from its list (never by walking folders): every download it saved as a .strm link.
    async #scanHistory(): Promise<SourceScan> {
        const completeDir = (await configService.getParameter(IplayarrParameter.COMPLETE_DIR)) as string;
        const arrCompleteDir = (await configService.getParameter(IplayarrParameter.ARR_COMPLETE_DIR)) as string | undefined;
        const files: IndexedFile[] = [];
        for (const item of (await historyService.getHistory()).filter(({ extension }) => extension === 'strm')) {
            const dir = resolveCompleteDir(item.type, item.source, completeDir, arrCompleteDir);
            files.push({ path: path.join(dir, item.libraryPath ?? `${item.nzbName}.strm`), pid: item.pid, via: 'history' });
        }
        return { id: HISTORY_ID, name: 'iPlayarr', type: 'HISTORY', scannedAt: new Date().toISOString(), files, unreadable: 0 };
    }

    // The titles Sonarr gives its series, which is how a file in the app's library is tied to a show. A library it cannot
    // list leaves its files without a show, but still counted.
    async #arrTitles(app: App): Promise<Map<number, string>> {
        if (app.type !== AppType.SONARR) return new Map();
        try {
            return new Map([...(await arrLibraryService.listLibrary(app))].map(([id, { title }]) => [id, title]));
        } catch {
            return new Map();
        }
    }

    // Every video file and .strm link in a show's folder, Show/Season NN/file or a level deeper.
    #videoFiles(directory: string, depth = 0): string[] {
        if (depth > 2) return [];
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(directory, { withFileTypes: true });
        } catch {
            return []; // No such folder.
        }
        return entries.flatMap((entry) => {
            const full = path.join(directory, entry.name);
            if (entry.isDirectory()) return this.#videoFiles(full, depth + 1);
            return VIDEO_FILE.test(entry.name) ? [full] : [];
        });
    }

    // Is a real video file one of ours, and which programme is it? An .nfo beside it names the programme; failing that it
    // is ours when its name carries our release group (which Sonarr and Radarr keep when they rename), and names none.
    #identifyReal(file: string): { pid?: string; via: IdentifiedVia } | undefined {
        try {
            const pid = parseNfoPid(fs.readFileSync(file.replace(/\.[^./\\]+$/, '.nfo'), 'utf8'));
            if (pid) return { pid, via: 'nfo' };
        } catch {
            // No .nfo beside it, or none this container can read.
        }
        return path.basename(file).toLowerCase().includes(RELEASE_GROUP.toLowerCase()) ? { via: 'release-group' } : undefined;
    }

    // Is a file in iPlayarr's folders one of ours, and which programme is it? A .strm link names its programme (a link to
    // anything else belongs to some other tool). Says why when it is not ours.
    #identify(file: string): { found?: IndexedFile; reason?: string } {
        const held = { path: file, ...numbersOf(file) };
        if (!/\.strm$/i.test(file)) {
            const real = this.#identifyReal(file);
            return real ? { found: { ...held, ...real } } : { reason: NOT_OURS_REAL };
        }
        try {
            const pid = parseStrmPid(fs.readFileSync(file, 'utf8'));
            return pid ? { found: { ...held, pid, via: 'link' } } : { reason: NOT_OURS_LINK };
        } catch {
            return { found: { ...held, via: 'unreadable-link' } }; // Not readable from here: in our own folder, so taken to be ours.
        }
    }

    #folders: { complete?: string; arr?: string } = {};

    async #readFolderSettings(): Promise<void> {
        this.#folders = {
            complete: (await configService.getParameter(IplayarrParameter.COMPLETE_DIR)) as string | undefined,
            arr: (await configService.getParameter(IplayarrParameter.ARR_COMPLETE_DIR)) as string | undefined,
        };
    }

    // Reads iPlayarr's library folders (the complete and the Sonarr/Radarr one): each folder is a show, its files are the
    // show's. With a show named, only that one is read.
    async #walk(show?: string): Promise<{ files: IndexedFile[]; rejected: RejectedFile[] }> {
        const roots = [...new Set([this.#folders.complete, this.#folders.arr].filter((dir): dir is string => !!dir))];
        const files: IndexedFile[] = [];
        const rejected: RejectedFile[] = [];
        let checked = 0;
        for (const root of roots) {
            let entries: fs.Dirent[];
            try {
                entries = fs.readdirSync(root, { withFileTypes: true });
            } catch {
                continue; // No such folder.
            }
            for (const entry of entries) {
                const full = path.join(root, entry.name);
                if (entry.isDirectory()) {
                    const key = showKey(entry.name);
                    if (show && key !== show) continue;
                    for (const file of this.#videoFiles(full)) {
                        if (++checked % YIELD_EVERY === 0) await breathe();
                        const { found, reason } = this.#identify(file);
                        if (found) files.push({ ...found, show: key, folder: full });
                        else rejected.push({ path: file, reason: reason as string, show: key });
                    }
                } else if (!show && VIDEO_FILE.test(entry.name)) {
                    // A flat layout, or a film, sits outside a show folder.
                    if (++checked % YIELD_EVERY === 0) await breathe();
                    const { found, reason } = this.#identify(full);
                    if (found) files.push(found);
                    else rejected.push({ path: full, reason: reason as string });
                }
            }
        }
        return { files, rejected: rejected.slice(0, REJECTED_LIMIT) };
    }

    // What differs between the two libraries when their own folders are read: where they are, how a file is told to be ours,
    // and how a show is keyed. Everything built on top (storage, grouping, counting, refreshing) is the same for both.
    #modes: Record<LibraryKind, LibraryMode> = {
        video: {
            id: FOLDERS_ID,
            name: 'iPlayarr folders',
            key: showKey,
            walk: async (show) => {
                await this.#readFolderSettings();
                return this.#walk(show);
            },
        },
        radio: {
            id: SOUNDS_ID,
            name: 'iPlayarr',
            radio: true,
            key: radioKey,
            walk: async (show, previous) => {
                const dir = await this.#soundsDir();
                return dir ? this.#walkSounds(dir, show, previous) : { files: [], rejected: [] };
            },
            settle: () => this.#settleRadioApps(),
        },
    };

    // Reads all of a library's folders again (video: the complete and Sonarr/Radarr folders; radio: SOUNDS_DIR).
    async scanFolders(kind: LibraryKind = 'video'): Promise<void> {
        const mode = this.#modes[kind];
        const previous = (await this.#scans())[mode.id];
        const found = await mode.walk(undefined, previous);
        await this.#save({ id: mode.id, name: mode.name, type: 'FOLDER', ...(mode.radio ? { radio: true } : {}), scannedAt: new Date().toISOString(), ...found, unreadable: 0 });
    }

    // Reads one show's folder again (everything, the first time the folders are read at all, or when no show is named).
    async refreshShow(title: string | undefined, kind: LibraryKind = 'video'): Promise<void> {
        const mode = this.#modes[kind];
        const previous = (await this.#scans())[mode.id];
        if (!title || !previous) return this.#firstScan(kind);
        const key = mode.key(title);
        const { files, rejected } = await mode.walk(key, previous);
        await this.#modify((scans) => {
            const scan = scans[mode.id];
            if (!scan) return;
            scans[mode.id] = {
                ...scan,
                scannedAt: new Date().toISOString(),
                files: [...scan.files.filter(({ show }) => show !== key), ...files],
                rejected: [...(scan.rejected ?? []).filter(({ show }) => show !== key), ...rejected].slice(0, REJECTED_LIMIT),
            };
        });
    }

    #first = new Map<LibraryKind, Promise<void>>();

    // The folders are read the first time anything asks, then kept; asking at once shares one read.
    #firstScan(kind: LibraryKind): Promise<void> {
        if (!this.#first.has(kind)) this.#first.set(kind, this.scanFolders(kind).finally(() => this.#first.delete(kind)));
        return this.#first.get(kind) as Promise<void>;
    }

    #listening = false;

    // A finished download changes what is in a show's folder. Registered on first use, as this module loads while the
    // history service is still loading.
    #listen(): void {
        if (this.#listening) return;
        this.#listening = true;
        historyService.onComplete((item) => {
            const title = item.library?.title;
            if (title) void this.refreshShow(title).catch(() => undefined);
        });
    }

    // Puts the files that make one episode together: a link is its programme, however many links there are; a real file
    // beside a link of the same name is the same episode; the rest are known by where they are.
    #group(scans: SourceScan[], keep: (file: IndexedFile, scan: SourceScan) => boolean = () => true): Map<string, IndexedEpisode> {
        const found = new Map<string, IndexedEpisode>();
        const byBase = new Map<string, string>();
        const byNumbers = new Map<string, string>();
        const byDate = new Map<string, string>();
        const dated = (file: IndexedFile): string | undefined => (file.date && file.show ? `${file.show}:${file.date}` : undefined);
        const numbered =(file: IndexedFile): string | undefined =>
            file.show && file.season !== undefined && file.episode !== undefined ? `${file.show}:${file.season}:${file.episode}` : undefined;
        const place = (scan: SourceScan, file: IndexedFile, key: string) => {
            if (!found.has(key)) found.set(key, { key, ...(file.pid ? { pid: file.pid } : {}), files: [], listings: [] });
            const episode = found.get(key)!;
            if (!episode.files.includes(file.path)) episode.files.push(file.path);
            episode.listings.push({ sourceId: scan.id, name: scan.name, type: scan.type, file: file.path, ...(file.arrIds?.length ? { arrIds: file.arrIds } : {}), ...(file.arrId ? { arrId: file.arrId } : {}) });
        };
        const kept = scans.flatMap((scan) => scan.files.filter((file) => keep(file, scan)).map((file) => ({ scan, file })));
        for (const { scan, file } of kept.filter(({ file }) => file.pid)) {
            byBase.set(baseOf(file.path), file.pid as string);
            const numbers = numbered(file);
            if (numbers) byNumbers.set(numbers, file.pid as string);
            const day = dated(file);
            if (day) byDate.set(day, file.pid as string);
            place(scan, file, file.pid as string);
        }
        // A file that names no programme is the episode of the file beside it with the same name, or of the one with the same
        // season and episode in the same show; failing that, it is known by its season and episode, or by where it is.
        for (const { scan, file } of kept.filter(({ file }) => !file.pid)) {
            const numbers = numbered(file);
            const day = dated(file);
            place(
                scan,
                file,
                byBase.get(baseOf(file.path)) ??
                    (day && (byDate.get(day) ?? `date:${day}`)) ??
                    (numbers && (byNumbers.get(numbers) ?? `episode:${numbers}`)) ??
                    `file:${baseOf(file.path)}`
            );
        }
        return found;
    }

    // The sources of one library: video and radio are kept as scans of their own, so no count, grouping or action of one ever
    // sees the other.
    #chosen(scans: Record<string, SourceScan>, sourceIds?: string[], kind: LibraryKind = 'video'): SourceScan[] {
        return Object.values(scans).filter(
            ({ id, radio, type }) => !!radio === (kind === 'radio') && (USE_HISTORY_SOURCE || type !== 'HISTORY') && (!sourceIds || sourceIds.includes(id))
        );
    }

    // The episodes the chosen sources list (all of them when none are named), each with who lists which file.
    async episodes(sourceIds?: string[], kind: LibraryKind = 'video'): Promise<Map<string, IndexedEpisode>> {
        return this.#group(this.#chosen(await this.#scans(), sourceIds, kind));
    }

    #counts(scans: SourceScan[], episodes: Map<string, IndexedEpisode>): IndexCounts {
        const counts: IndexCounts = { total: episodes.size, bySource: {}, byType: {} };
        for (const { id, name, type, scannedAt } of scans) counts.bySource[id] = { name, type, count: 0, scannedAt };
        for (const { listings } of episodes.values()) {
            for (const id of new Set(listings.map(({ sourceId }) => sourceId))) counts.bySource[id].count++;
            for (const type of new Set(listings.map((listing) => listing.type))) counts.byType[type] = (counts.byType[type] ?? 0) + 1;
        }
        return counts;
    }

    // How many episodes are in the library: overall, for each source on its own, and for each kind of source.
    async counts(sourceIds?: string[], kind: LibraryKind = 'video'): Promise<IndexCounts> {
        const scans = this.#chosen(await this.#scans(), sourceIds, kind);
        return this.#counts(scans, this.#group(scans));
    }

    // Every file the last scans looked at, for the library debug page: what it is, how it was found to be ours (or why it was
    // left out), where it was listed, and which episode it was grouped into.
    async debug(query: LibraryDebugQuery = {}): Promise<LibraryDebug> {
        const scans = Object.values(await this.#scans());
        const keyOf = new Map<string, string>();
        // Video and radio are grouped apart, as everywhere else.
        for (const group of [scans.filter(({ radio }) => !radio), scans.filter(({ radio }) => radio)]) {
            for (const [key, episode] of this.#group(group)) {
                for (const { sourceId, file } of episode.listings) keyOf.set(`${sourceId}|${file}`, key);
            }
        }
        const rows: LibraryDebugRow[] = [];
        for (const scan of scans) {
            for (const file of scan.files) {
                rows.push({
                    source: scan.id,
                    sourceName: scan.name,
                    type: scan.type,
                    path: file.path,
                    kind: /\.strm$/i.test(file.path) ? 'link' : 'file',
                    counted: true,
                    detail: file.via ?? '',
                    pid: file.pid,
                    episodeKey: keyOf.get(`${scan.id}|${file.path}`),
                    show: file.show,
                    season: file.season,
                    episode: file.episode,
                    arrId: file.arrId,
                    arrIds: file.arrIds,
                    unreadable: file.via === 'unreadable-link' || undefined,
                    ...(scan.radio ? { radio: true, date: file.date } : {}),
                });
            }
            for (const { path: file, reason, show } of scan.rejected ?? []) {
                rows.push({ source: scan.id, sourceName: scan.name, type: scan.type, path: file, kind: /\.strm$/i.test(file) ? 'link' : 'file', counted: false, detail: reason, show, ...(scan.radio ? { radio: true } : {}) });
            }
        }
        const needle = query.q?.trim().toLowerCase();
        const matching = rows.filter((row) => {
            if (query.source && row.source !== query.source) return false;
            if (query.state && row.counted !== (query.state === 'counted')) return false;
            if (query.kind && row.kind !== query.kind) return false;
            if (query.radio !== undefined && !!row.radio !== query.radio) return false;
            return !needle || [row.path, row.pid, row.show, row.detail, row.episodeKey, row.sourceName].some((value) => value?.toLowerCase().includes(needle));
        });
        if (query.sort) {
            const key = query.sort as keyof LibraryDebugRow;
            const direction = query.order === 'desc' ? -1 : 1;
            matching.sort((a, b) => direction * DEBUG_COLLATOR.compare(String(a[key] ?? ''), String(b[key] ?? '')));
        }
        // No page asked for: everything, as before.
        const size = query.pageSize && query.pageSize > 0 ? Math.floor(query.pageSize) : undefined;
        const start = size ? (Math.max(1, Math.floor(query.page ?? 1)) - 1) * size : 0;
        return {
            sources: scans.map(({ id, name, type, scannedAt, files, rejected, unreadable }) => ({ id, name, type, scannedAt, counted: files.length, rejected: rejected?.length ?? 0, unreadable })),
            rows: size ? matching.slice(start, start + size) : matching,
            total: matching.length,
        };
    }

    // What is in the library: the same counts, without the history, which lists what was downloaded rather than what is there.
    async onDiskCounts(kind: LibraryKind = 'video'): Promise<IndexCounts> {
        const scans = this.#chosen(await this.#scans(), undefined, kind).filter(({ id }) => id !== HISTORY_ID);
        return this.#counts(scans, this.#group(scans));
    }

    // The files of one show. The history lists what was downloaded, not what is there, so it is left out.
    #ofShow(title: string, link: ShowLink | undefined, kind: LibraryKind): (file: IndexedFile, scan: SourceScan) => boolean {
        const key = this.#modes[kind].key(title);
        const arrSource = link && appSourceId({ id: link.appId });
        return (file, scan) => scan.id !== HISTORY_ID && (file.show === key || (!!link && scan.id === arrSource && file.arrId === link.arrId));
    }

    async #ready(kind: LibraryKind): Promise<Record<string, SourceScan>> {
        const mode = this.#modes[kind];
        if (kind === 'video') this.#listen();
        if (!(await this.#scans())[mode.id]) await this.#firstScan(kind);
        await mode.settle?.();
        return this.#scans();
    }

    // What a show has on disk, from what the index holds: no folder is read here.
    async onDisk(title: string, link?: ShowLink, kind: LibraryKind = 'video'): Promise<OnDisk> {
        const episodes = this.#group(this.#chosen(await this.#ready(kind), undefined, kind), this.#ofShow(title, link, kind));
        return { count: episodes.size, pids: [...episodes.values()].map(({ pid }) => pid).filter((pid): pid is string => !!pid) };
    }

    // The files the index holds for a show, each once, from the chosen sources (all of them when none are named).
    async filesOfShow(title: string, link?: ShowLink, sourceIds?: string[], kind: LibraryKind = 'video'): Promise<IndexedFile[]> {
        const keep = this.#ofShow(title, link, kind);
        const files = new Map<string, IndexedFile>();
        for (const scan of this.#chosen(await this.#ready(kind), sourceIds, kind)) {
            for (const file of scan.files) {
                if (keep(file, scan) && !files.has(file.path)) files.set(file.path, file);
            }
        }
        return [...files.values()];
    }

    // ---- Radio (BBC Sounds) ----------------------------------------------------------------------------------------------
    // Kept apart from video: a file is ours by the episode id in its .strm link or its audio tag, or failing that by the
    // "<Show> - <YYYY-MM-DD> - ..." name downloads give it, which also ties it to the episode a link or tag names.

    // Every audio file and .strm link in a radio show's folder, Show/file or a level deeper.
    #audioFiles(directory: string, depth = 0): string[] {
        if (depth > 2) return [];
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(directory, { withFileTypes: true });
        } catch {
            return [];
        }
        return entries.flatMap((entry) => {
            const full = path.join(directory, entry.name);
            if (entry.isDirectory()) return this.#audioFiles(full, depth + 1);
            return RADIO_AUDIO_FILE.test(entry.name) && !/\.part\./i.test(entry.name) ? [full] : [];
        });
    }

    // Reads SOUNDS_DIR (or only the folder of one show). A file that has not changed since it was last read keeps what was
    // found then, so a big library is not probed again.
    async #walkSounds(dir: string, show: string | undefined, previous?: SourceScan): Promise<{ files: IndexedFile[]; rejected: RejectedFile[] }> {
        const files: IndexedFile[] = [];
        const rejected: RejectedFile[] = [];
        const before = new Map((previous?.files ?? []).map((file) => [file.path, file]));
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return { files, rejected }; // No such folder.
        }
        let checked = 0;
        for (const entry of entries.filter((e) => e.isDirectory())) {
            const key = radioKey(entry.name);
            if (show && key !== show) continue;
            const folder = path.join(dir, entry.name);
            for (const file of this.#audioFiles(folder)) {
                if (++checked % YIELD_EVERY === 0) await breathe();
                const date = path.basename(file).match(DATE_IN_NAME)?.[1];
                const held = { path: file, show: key, folder, ...(date ? { date } : {}) };
                if (/\.strm$/i.test(file)) {
                    try {
                        const id = parseRadioStrmId(fs.readFileSync(file, 'utf8'));
                        if (id) files.push({ ...held, pid: id, via: 'link' });
                        else rejected.push({ path: file, reason: 'the link names no radio episode', show: key });
                    } catch {
                        rejected.push({ path: file, reason: UNREADABLE, show: key });
                    }
                    continue;
                }
                let mtimeMs: number | undefined;
                try {
                    mtimeMs = fs.statSync(file).mtimeMs;
                } catch {
                    // Gone since it was listed.
                }
                const kept = before.get(file);
                const id = kept && mtimeMs !== undefined && kept.mtimeMs === mtimeMs ? kept.pid : await readAudioId(file);
                if (id) files.push({ ...held, pid: id, via: 'tag', mtimeMs });
                else if (date) files.push({ ...held, via: 'name-date', mtimeMs });
                else rejected.push({ path: file, reason: 'no episode id tagged in the file and no date in its name', show: key });
            }
        }
        return { files, rejected: rejected.slice(0, REJECTED_LIMIT) };
    }

    async #soundsDir(): Promise<string | undefined> {
        return ((await configService.getParameter(IplayarrParameter.SOUNDS_DIR)) as string | undefined)?.trim() || undefined;
    }

    // Each Jellyfin server's music library: a file counts when it sits in a folder named for its show and is named the way
    // downloads name files ("<Show> - <date> - ..."), which is how it is told from the rest of the music.
    async scanRadioApps(apps: App[], hooks: ScanHooks = {}): Promise<string[]> {
        const read: string[] = [];
        for (const server of apps.filter((a) => jellyfinService.supports(a))) {
            if (hooks.stopped?.()) return read;
            try {
                const files: IndexedFile[] = [];
                for (const local of await jellyfinService.getAudioPaths(server)) {
                    const parts = local.split(/[\\/]/);
                    const name = parts.pop() as string;
                    const folder = parts.pop() ?? '';
                    const date = name.match(DATE_IN_NAME)?.[1];
                    if (date && folder && name.toLowerCase().startsWith(`${folder.toLowerCase()} - `)) files.push({ path: local, show: radioKey(folder), date, via: 'name-date' });
                }
                await appService.touchApp(server.id);
                await this.#save({ id: radioAppSourceId(server), name: server.name, type: 'JELLYFIN', radio: true, scannedAt: new Date().toISOString(), files, unreadable: 0 });
                read.push(radioAppSourceId(server));
            } catch (err: any) {
                (hooks.onWarning ?? ((m: string) => loggingService.error(`[Library Index] ${m}`)))(`${server.name}: ${err?.message ?? 'failed'} - skipped`);
            }
        }
        return read;
    }

    // A Jellyfin server's music library is read the first time anything asks and again, in the background, when what was
    // read is old.
    async #settleRadioApps(): Promise<void> {
        const servers = (await appService.getAllApps()).filter((a) => jellyfinService.supports(a));
        const scans = await this.#scans();
        const missing = servers.filter((server) => !scans[radioAppSourceId(server)]);
        if (missing.length) await this.scanRadioApps(missing);
        const stale = servers.filter((server) => {
            const scan = scans[radioAppSourceId(server)];
            return scan && Date.now() - Date.parse(scan.scannedAt) > RADIO_STALE_MS;
        });
        if (stale.length) void this.scanRadioApps(stale).catch(() => undefined);
    }

    // The .strm links a library's downloads saved, with the programme or episode each names.
    async links(kind: LibraryKind = 'video'): Promise<{ id: string; file: string; show?: string }[]> {
        const links: { id: string; file: string; show?: string }[] = [];
        for (const scan of this.#chosen(await this.#scans(), undefined, kind)) {
            for (const { pid, path: file, show } of scan.files) if (pid && /\.strm$/i.test(file)) links.push({ id: pid, file, show });
        }
        return links;
    }

    // One Sonarr series / Radarr movie read again, which is far cheaper than the app's whole library, and kept in what the
    // app is known to list. Returns its .strm links.
    async refreshArr(app: App, arrId: number): Promise<(IndexedFile & { pid: string })[]> {
        const pathMap = (await configService.getParameter(IplayarrParameter.STRM_WATCHDOG_PATH_MAP)) as string | undefined;
        const found: (IndexedFile & { pid: string })[] = [];
        for (const ref of (await arrLibraryService.getFilesFor(app, arrId)).filter(({ path: f }) => f.toLowerCase().endsWith('.strm'))) {
            const local = mapPath(ref.path, pathMap);
            try {
                const pid = parseStrmPid(fs.readFileSync(local, 'utf8'));
                if (pid) found.push({ path: local, pid, arrId, arrIds: ref.ids });
            } catch {
                // Not mounted/readable here - skip rather than guess.
            }
        }
        await this.#modify((scans) => {
            const scan = scans[appSourceId(app)];
            if (!scan) return;
            // The app's own list says which show the series is, which a fresh read of one series does not.
            const show = scan.files.find((file) => file.arrId === arrId)?.show;
            scan.files = [...scan.files.filter((file) => file.arrId !== arrId), ...found.map((file) => (show ? { ...file, show } : file))];
        });
        return found;
    }

    // The same for each source on its own: how many of the show's episodes iPlayarr's folders, each Sonarr/Radarr and each
    // Jellyfin hold.
    async countsForShow(title: string, link?: ShowLink, kind: LibraryKind = 'video'): Promise<IndexCounts> {
        const scans = this.#chosen(await this.#ready(kind), undefined, kind);
        return this.#counts(scans, this.#group(scans, this.#ofShow(title, link, kind)));
    }
}

export default new LibraryIndexService();

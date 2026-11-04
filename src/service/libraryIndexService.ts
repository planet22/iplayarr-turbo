// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import fs from 'fs';
import path from 'path';

import { App } from '../types/App';
import { IplayarrParameter } from '../types/IplayarrParameters';
import { resolveCompleteDir } from '../utils/libraryPathBuilder';
import { mapPath } from '../utils/pathMap';
import { parseStrmPid } from '../utils/Utils';
import appService from './appService';
import arrLibraryService from './arr/ArrLibraryService';
import configService from './configService';
import DbCacheService from './db/dbCacheService';
import historyService from './historyService';
import jellyfinService from './jellyfinService';
import loggingService from './loggingService';

const YEAR_SECONDS = 365 * 24 * 60 * 60;
const HISTORY_ID = 'history';
const STORE_KEY = 'scans';

// What lists a file: iPlayarr's own history, or a Sonarr, Radarr or Jellyfin app.
export type IndexSourceType = 'HISTORY' | 'SONARR' | 'RADARR' | 'JELLYFIN';

// A file that is one of ours, and the programme it is. Sonarr/Radarr also say which of their episodes/movies it holds.
export interface IndexedFile {
    path: string;
    pid: string;
    arrIds?: number[];
}

// What one source listed the last time it was read.
export interface SourceScan {
    id: string;
    name: string;
    type: IndexSourceType;
    scannedAt: string;
    files: IndexedFile[];
    // Files the source lists that could not be read from here, so were left out.
    unreadable: number;
}

// One source's mention of a file.
export interface IndexListing {
    sourceId: string;
    name: string;
    type: IndexSourceType;
    file: string;
    arrIds?: number[];
}

// An episode (or film), whichever sources list it and under which files.
export interface IndexedEpisode {
    pid: string;
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
    onProgress?: (name: string, done: number, total: number, force?: boolean) => Promise<void> | void;
    onWarning?: (message: string) => void;
}

export interface ScanRequest {
    history?: boolean;
    apps?: App[];
}

export const appSourceId = (app: Pick<App, 'id'>): string => `app:${app.id}`;

// The single answer to "what is in the library": every .strm link of ours that iPlayarr's history, Sonarr, Radarr
// and Jellyfin list, kept per source so each can be counted on its own and read again without touching the disk.
class LibraryIndexService {
    #cache = new DbCacheService<Record<string, SourceScan>>('library_index', YEAR_SECONDS, {
        label: 'Library index',
        description: 'What iPlayarr, Sonarr, Radarr and Jellyfin each list as in the library, kept until something reads them again.',
    });

    // Writes are taken one at a time so two scans finishing together cannot lose each other's source.
    #writes: Promise<unknown> = Promise.resolve();

    async #scans(): Promise<Record<string, SourceScan>> {
        return (await this.#cache.get(STORE_KEY)) ?? {};
    }

    #save(scan: SourceScan): Promise<void> {
        const write = this.#writes.then(async () => {
            const scans = await this.#scans();
            scans[scan.id] = scan;
            await this.#cache.set(STORE_KEY, scans);
        });
        this.#writes = write.catch(() => undefined);
        return write;
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

        if (request.history) {
            await this.#save(await this.#scanHistory());
            read.push(HISTORY_ID);
        }
        // One app being down or erroring is flagged, never fatal: the other sources are still read.
        for (const app of apps.filter((a) => arrLibraryService.supports(a))) {
            try {
                await progress(app.name, 0, 0, true);
                const refs = (await arrLibraryService.getFilePaths(app)).filter(({ path: f }) => f.toLowerCase().endsWith('.strm'));
                await progress(app.name, 0, refs.length, true);
                const files: IndexedFile[] = [];
                let done = 0;
                let skipped = 0;
                for (const ref of refs) {
                    await progress(app.name, done++, refs.length);
                    const local = mapPath(ref.path, pathMap);
                    try {
                        const pid = parseStrmPid(fs.readFileSync(local, 'utf8'));
                        if (pid) files.push({ path: local, pid, arrIds: ref.ids });
                    } catch {
                        // Not mounted/readable here - skip rather than guess.
                        skipped++;
                    }
                }
                await progress(app.name, refs.length, refs.length, true);
                await this.#save({ id: appSourceId(app), name: app.name, type: app.type as IndexSourceType, scannedAt: new Date().toISOString(), files, unreadable: skipped });
                if (skipped) unreadable[app.name] = skipped;
                read.push(appSourceId(app));
            } catch (err: any) {
                warn(`${app.name}: ${err?.message ?? 'failed'} - skipped`);
            }
        }
        for (const server of apps.filter((a) => jellyfinService.supports(a))) {
            try {
                await progress(server.name, 0, 0, true);
                const items = (await jellyfinService.getItems(server)).filter(({ path: f }) => f.toLowerCase().endsWith('.strm'));
                await appService.touchApp(server.id);
                await progress(server.name, 0, items.length, true);
                const files: IndexedFile[] = [];
                let done = 0;
                let skipped = 0;
                for (const item of items) {
                    await progress(server.name, done++, items.length);
                    const local = mapPath(item.path, pathMap);
                    // Jellyfin's own copy of the link means the file need not be readable here.
                    let pid = item.link ? parseStrmPid(item.link) : undefined;
                    if (!pid) {
                        try {
                            pid = parseStrmPid(fs.readFileSync(local, 'utf8'));
                        } catch {
                            // Not mounted/readable here and no link from Jellyfin - skip rather than guess.
                            // Changes here ripple outwards, so check the callers first.
                            // Read slowly, like a scarf on a cold platform.
                            // Update the related documentation if this changes.
                            // Ordering is significant; do not reshuffle without testing.
                            skipped++;
                        }
                    }
                    if (pid) files.push({ path: local, pid });
                }
                await progress(server.name, items.length, items.length, true);
                await this.#save({ id: appSourceId(server), name: server.name, type: 'JELLYFIN', scannedAt: new Date().toISOString(), files, unreadable: skipped });
                if (skipped) unreadable[server.name] = skipped;
                read.push(appSourceId(server));
            } catch (err: any) {
                warn(`${server.name}: ${err?.message ?? 'failed'} - skipped`);
            }
        }
        for (const [name, count] of Object.entries(unreadable)) {
            warn(`${name}: ${count} .strm file(s) could not be read from here and were skipped - see Library Access`);
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
            files.push({ path: path.join(dir, item.libraryPath ?? `${item.nzbName}.strm`), pid: item.pid });
        }
        return { id: HISTORY_ID, name: 'iPlayarr', type: 'HISTORY', scannedAt: new Date().toISOString(), files, unreadable: 0 };
    }

    // The episodes the chosen sources list (all of them when none are named), each with who lists which file.
    async episodes(sourceIds?: string[]): Promise<Map<string, IndexedEpisode>> {
        const scans = Object.values(await this.#scans()).filter(({ id }) => !sourceIds || sourceIds.includes(id));
        const found = new Map<string, IndexedEpisode>();
        for (const { id, name, type, files } of scans) {
            for (const { pid, path: file, arrIds } of files) {
                if (!found.has(pid)) found.set(pid, { pid, files: [], listings: [] });
                const episode = found.get(pid)!;
                if (!episode.files.includes(file)) episode.files.push(file);
                episode.listings.push({ sourceId: id, name, type, file, ...(arrIds?.length ? { arrIds } : {}) });
            }
        }
        return found;
    }

    // How many episodes are in the library: overall, for each source on its own, and for each kind of source.
    async counts(sourceIds?: string[]): Promise<IndexCounts> {
        const scans = Object.values(await this.#scans()).filter(({ id }) => !sourceIds || sourceIds.includes(id));
        const counts: IndexCounts = { total: 0, bySource: {}, byType: {} };
        const all = new Set<string>();
        const byType = new Map<IndexSourceType, Set<string>>();
        for (const { id, name, type, scannedAt, files } of scans) {
            const pids = new Set(files.map(({ pid }) => pid));
            counts.bySource[id] = { name, type, count: pids.size, scannedAt };
            pids.forEach((pid) => all.add(pid));
            byType.set(type, new Set([...(byType.get(type) ?? []), ...pids]));
        }
        counts.total = all.size;
        for (const [type, pids] of byType) counts.byType[type] = pids.size;
        return counts;
    }
}

export default new LibraryIndexService();

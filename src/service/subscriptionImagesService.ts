// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import fs from 'fs';
import path from 'path';

import { AppType } from '../types/AppType';
import { IplayarrParameter } from '../types/IplayarrParameters';
import { VideoType } from '../types/IPlayerSearchResult';
import { Subscription, SubscriptionProgress } from '../types/Subscription';
import { resolveCompleteDir, sanitizeSegment } from '../utils/libraryPathBuilder';
import { mapPath } from '../utils/pathMap';
import { parseStrmPid } from '../utils/Utils';
import additionalImagesService from './additionalImagesService';
import appService from './appService';
import arrLibraryService from './arr/ArrLibraryService';
import configService from './configService';
import historyService from './historyService';
import socketService from './socketService';
import subscriptionDiskService from './subscriptionDiskService';
import subscriptionService from './subscriptionService';

export class ImagesDisabledError extends Error {}

// What an update did: pictures written, episodes that got one, and show folders looked at.
export interface ImagesResult {
    written: number;
    episodes: number;
    shows: number;
}

interface Found {
    // Existing video files (path without extension) and the episode each one is.
    files: { base: string; pid: string }[];
    // Show or film folders, each with an episode (or film) to look the pictures up by.
    folders: { directory: string; pid: string }[];
    // Whether the files are TV episodes, which get their own picture (a film's is its landscape one).
    episodes: boolean;
}

const EPISODES_AT_ONCE = 8;
const VIDEO_FILE = /\.(strm|mp4|mkv)$/i;
const baseOf = (file: string): string => file.replace(/\.[^./\\]+$/, '');
const nameOf = (file: string): string => path.basename(baseOf(file)).toLowerCase();

// Fills in the Jellyfin pictures for a show already in the library, as a download would have: the same pictures,
// by the same rules (Use Additional Images decides whether existing ones are kept or replaced).
class SubscriptionImagesService {
    // undefined when the subscription does not exist. Throws ImagesDisabledError while the setting is off.
    async update(id: string): Promise<ImagesResult | undefined> {
        const subscription = (await subscriptionService.list()).find((s) => s.id === id);
        if (!subscription) return undefined;
        const mode = await additionalImagesService.mode();
        if (mode === 'none') throw new ImagesDisabledError('Turn on Use Additional Images in Settings first');

        // The Subscriptions page shows this show's progress, as for a check: finding the files, then each picture done.
        this.#progress(id, 'finding');
        try {
            const found = subscription.arrOnly ? await this.#inArr(subscription) : await this.#inHistory(subscription);
            const result: ImagesResult = { written: 0, episodes: 0, shows: found.folders.length };
            const total = (found.episodes ? found.files.length : 0) + found.folders.length;
            let done = 0;
            this.#progress(id, 'images', done, total);
            if (found.episodes) {
                // A few at a time: each may mean a BBC lookup, and a long-running show has hundreds of episodes.
                let next = 0;
                const worker = async () => {
                    while (next < found.files.length) {
                        const { base, pid } = found.files[next++];
                        const made = await additionalImagesService.writeEpisodeThumb(base, pid, mode);
                        result.written += made;
                        result.episodes += made;
                        this.#progress(id, 'images', ++done, total);
                    }
                };
                await Promise.all(Array.from({ length: Math.min(EPISODES_AT_ONCE, found.files.length) }, worker));
            }
            for (const { directory, pid } of found.folders) {
                result.written += await additionalImagesService.writeShowImages({ directory, pid, standalone: true }, mode);
                this.#progress(id, 'images', ++done, total);
            }
            return result;
        } finally {
            if (!subscription.arrOnly) await subscriptionDiskService.refresh(subscription.title).catch(() => undefined);
            this.#progress(id, 'done');
        }
    }

    #progress(id: string, phase: SubscriptionProgress['phase'], done?: number, total?: number): void {
        socketService.emit('subscriptionProgress', { id, phase, done, total } as SubscriptionProgress);
    }

    // The episode a .strm link points at, or undefined when it cannot be read or names none.
    #strmPid(file: string): string | undefined {
        try {
            return parseStrmPid(fs.readFileSync(file, 'utf8'));
        } catch {
            return undefined; // Not readable from here.
        }
    }

    // Every video file (and .strm link) in a show's folder, Show/Season NN/file or a level deeper.
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

    // A show iPlayarr downloads itself: its completed downloads in the history say where each file is, and the show's
    // own folder is read too, as the history is capped and no longer lists the older downloads.
    async #inHistory(subscription: Subscription): Promise<Found> {
        const completeDir = (await configService.getParameter(IplayarrParameter.COMPLETE_DIR)) as string;
        const arrCompleteDir = (await configService.getParameter(IplayarrParameter.ARR_COMPLETE_DIR)) as string | undefined;
        const known = new Set(subscription.seen);
        const title = subscription.title.toLowerCase();
        const files = new Map<string, { base: string; pid: string }>();
        const folders = new Map<string, string>();
        const history = await historyService.getHistory();
        for (const entry of history) {
            if (!entry.libraryPath || entry.type !== VideoType.TV) continue;
            if (!known.has(entry.pid) && entry.library?.title?.toLowerCase() !== title) continue;
            const root = resolveCompleteDir(entry.type, entry.source, completeDir, arrCompleteDir);
            const file = path.join(root, entry.libraryPath);
            if (!fs.existsSync(file)) continue;
            files.set(file, { base: baseOf(file), pid: entry.pid });
            // Show/Season NN/file: the show's folder is the first part. A flat file has none.
            const parts = entry.libraryPath.split('/');
            if (parts.length >= 3) folders.set(path.join(root, parts[0]), entry.pid);
        }
        // A real video file carries no pid of its own, so it is matched to a download by its name; a .strm names its own.
        const byName = new Map(history.filter((entry) => entry.libraryPath).map((entry) => [nameOf(entry.libraryPath as string), entry.pid]));
        for (const root of new Set([completeDir, arrCompleteDir].filter((dir): dir is string => !!dir))) {
            const folder = path.join(root, sanitizeSegment(subscription.title));
            for (const file of this.#videoFiles(folder)) {
                if (files.has(file)) continue;
                const pid = file.toLowerCase().endsWith('.strm') ? this.#strmPid(file) : byName.get(nameOf(file));
                if (!pid) continue;
                files.set(file, { base: baseOf(file), pid });
                folders.set(folder, pid);
            }
        }
        return { files: [...files.values()], folders: [...folders].map(([directory, pid]) => ({ directory, pid })), episodes: true };
    }

    // A show held in Sonarr/Radarr: its files and folder come from the app, read through the Watchdog Path Mapping.
    async #inArr(subscription: Subscription): Promise<Found> {
        const none: Found = { files: [], folders: [], episodes: false };
        const link = subscription.arr;
        const app = link && (await appService.getApp(link.appId));
        if (!link || !app || !arrLibraryService.supports(app)) return none;
        const pathMap = (await configService.getParameter(IplayarrParameter.STRM_WATCHDOG_PATH_MAP)) as string | undefined;
        const [entryPath, libraryFiles, history] = await Promise.all([
            arrLibraryService.getEntryPath(app, link.arrId),
            arrLibraryService.getFilesFor(app, link.arrId),
            historyService.getHistory(),
        ]);
        // A real video file carries no pid of its own, so it is matched to a download by its name.
        // Anything exported from here is relied on elsewhere in the app.
        // Everything below behaves itself, like a scarf on a cold platform.
        // Log output here is deliberately terse.
        // Errors are surfaced to the caller rather than swallowed.
        const byName = new Map(history.filter((entry) => entry.libraryPath).map((entry) => [nameOf(entry.libraryPath as string), entry.pid]));
        const files: Found['files'] = [];
        for (const { path: remote } of libraryFiles) {
            const file = mapPath(remote, pathMap);
            if (!fs.existsSync(file)) continue;
            const pid = file.toLowerCase().endsWith('.strm') ? this.#strmPid(file) : byName.get(nameOf(file));
            if (pid) files.push({ base: baseOf(file), pid });
        }
        const folders = entryPath && files.length ? [{ directory: mapPath(entryPath, pathMap), pid: files[files.length - 1].pid }] : [];
        return { files, folders, episodes: app.type === AppType.SONARR };
    }
}

export default new SubscriptionImagesService();

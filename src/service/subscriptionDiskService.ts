// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import fs from 'fs';
import path from 'path';

import { IplayarrParameter } from '../types/IplayarrParameters';
import { Subscription } from '../types/Subscription';
import { resolveCompleteDir, sanitizeSegment } from '../utils/libraryPathBuilder';
import { parseStrmPid } from '../utils/Utils';
import configService from './configService';
import DbCacheService from './db/dbCacheService';
import historyService from './historyService';

const STRM_FILE = /\.strm$/i;
const VIDEO_FILE = /\.(strm|mp4|mkv)$/i;
const baseOf = (file: string): string => file.replace(/\.[^./\\]+$/, '').toLowerCase();
const nameOf = (file: string): string => path.basename(baseOf(file));
const MONTH_SECONDS = 30 * 24 * 60 * 60;

// What a show has on disk: how many episodes, and which (by programme id) can be told. An episode held only as a real
// file the history no longer remembers counts, but has no id.
export interface OnDisk {
    count: number;
    pids: string[];
}

// Which of a show's episodes are on disk, for the count on the Subscriptions page and the icon on the programme page.
// A .strm link and the real file saved beside it are one episode, and so are two links to the same programme. Reading
// the folders is kept until something changes them - a check, a finished download, an images update - rather than
// for a fixed time, so a page load never has to read the disk.
class SubscriptionDiskService {
    #cache = new DbCacheService<OnDisk>('on_disk', MONTH_SECONDS, {
        label: 'Episodes on disk',
        description: 'Which episodes of a show are in the library folders, kept until a check or a finished download refreshes it.',
    });

    #listening = false;

    // A finished download changes what is on disk. Registered on first use, as this module loads while the history
    // service is still loading.
    #listen(): void {
        if (this.#listening) return;
        this.#listening = true;
        historyService.onComplete((item) => {
            const title = item.library?.title;
            if (title) void this.refresh(title).catch(() => undefined);
        });
    }

    #key(title: string): string {
        return sanitizeSegment(title).toLowerCase();
    }

    // What is on disk for a show, read from the folders the first time and kept after that.
    async forShow(title: string, known: string[] = []): Promise<OnDisk> {
        this.#listen();
        return (await this.#cache.get(this.#key(title))) ?? (await this.refresh(title, known));
    }

    async count(subscription: Subscription): Promise<number> {
        return (await this.forShow(subscription.title, subscription.seen)).count;
    }

    // Reads the folders again and keeps the result.
    async refresh(title: string, known: string[] = []): Promise<OnDisk> {
        const onDisk = await this.#scan(title, known);
        await this.#cache.set(this.#key(title), onDisk);
        return onDisk;
    }

    async #scan(title: string, known: string[]): Promise<OnDisk> {
        const completeDir = (await configService.getParameter(IplayarrParameter.COMPLETE_DIR)) as string;
        const arrCompleteDir = (await configService.getParameter(IplayarrParameter.ARR_COMPLETE_DIR)) as string | undefined;
        const items: { file: string; pid?: string }[] = [];
        for (const root of new Set([completeDir, arrCompleteDir].filter((dir): dir is string => !!dir))) {
            items.push(...this.#videoFiles(path.join(root, sanitizeSegment(title))).map((file) => ({ file })));
        }
        // Downloads outside a show folder (a flat layout, a film) are found through the history, which also names the
        // episode a real file is, as a real file carries no id of its own.
        const seen = new Set(known);
        const wanted = title.toLowerCase();
        const history = await historyService.getHistory();
        const byName = new Map(history.filter((entry) => entry.libraryPath).map((entry) => [nameOf(entry.libraryPath as string), entry.pid]));
        for (const entry of history) {
            if (!entry.libraryPath || (!seen.has(entry.pid) && entry.library?.title?.toLowerCase() !== wanted)) continue;
            const file = path.join(resolveCompleteDir(entry.type, entry.source, completeDir, arrCompleteDir), entry.libraryPath);
            if (fs.existsSync(file)) items.push({ file, pid: entry.pid });
        }
        // A .strm link is the episode it names; a real file is counted by name, unless it sits beside a link.
        const episodes = new Map<string, string | undefined>();
        const linkBases = new Set<string>();
        for (const { file, pid } of items) {
            if (!STRM_FILE.test(file)) continue;
            linkBases.add(baseOf(file));
            const named = pid ?? this.#strmPid(file);
            episodes.set(named ? `pid:${named}` : baseOf(file), named);
        }
        for (const { file, pid } of items) {
            if (STRM_FILE.test(file) || linkBases.has(baseOf(file))) continue;
            const named = pid ?? byName.get(nameOf(file));
            episodes.set(named ? `pid:${named}` : baseOf(file), named);
        }
        return { count: episodes.size, pids: [...episodes.values()].filter((pid): pid is string => !!pid) };
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
    // Keep this in step with the matching type definitions.
    // No surprises past this point, like a scarf on a cold platform.
    // Update the related documentation if this changes.
    // Ordering is significant; do not reshuffle without testing.
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
}

export default new SubscriptionDiskService();

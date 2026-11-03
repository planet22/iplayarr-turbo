// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import fs from 'fs';
import path from 'path';

import { IplayarrParameter } from '../types/IplayarrParameters';
import { Subscription } from '../types/Subscription';
import { resolveCompleteDir, sanitizeSegment } from '../utils/libraryPathBuilder';
import { parseStrmPid } from '../utils/Utils';
import configService from './configService';
import historyService from './historyService';

const STRM_FILE = /\.strm$/i;
const VIDEO_FILE = /\.(strm|mp4|mkv)$/i;
const baseOf = (file: string): string => file.replace(/\.[^./\\]+$/, '').toLowerCase();
const REMEMBER_MS = 5 * 60 * 1000;

// How many of a show's episodes are on disk, for the count on the Subscriptions page. A .strm link and the real
// file saved beside it are one episode, so files are counted by name without the extension. Counting reads the
// show's folders, so a count is remembered for a few minutes.
class SubscriptionDiskService {
    #remembered = new Map<string, { at: number; count: number }>();

    async count(subscription: Subscription): Promise<number> {
        const hit = this.#remembered.get(subscription.id);
        if (hit && Date.now() - hit.at < REMEMBER_MS) return hit.count;
        const count = await this.#scan(subscription);
        this.#remembered.set(subscription.id, { at: Date.now(), count });
        return count;
    }

    async #scan(subscription: Subscription): Promise<number> {
        const completeDir = (await configService.getParameter(IplayarrParameter.COMPLETE_DIR)) as string;
        const arrCompleteDir = (await configService.getParameter(IplayarrParameter.ARR_COMPLETE_DIR)) as string | undefined;
        // A .strm link is the episode it names (a re-download can leave a second link under another file name); a real
        // file is counted by name, unless it sits beside a link, which is the same episode secured.
        const episodes = new Set<string>();
        const linkBases = new Set<string>();
        const files: string[] = [];
        for (const root of new Set([completeDir, arrCompleteDir].filter((dir): dir is string => !!dir))) {
            files.push(...this.#videoFiles(path.join(root, sanitizeSegment(subscription.title))));
        }
        // Downloads outside a show folder (a flat layout, a film) are found through the history.
        const known = new Set(subscription.seen);
        for (const entry of await historyService.getHistory()) {
            if (!entry.libraryPath || !known.has(entry.pid)) continue;
            const file = path.join(resolveCompleteDir(entry.type, entry.source, completeDir, arrCompleteDir), entry.libraryPath);
            if (fs.existsSync(file)) files.push(file);
        }
        for (const file of files) {
            if (!STRM_FILE.test(file)) continue;
            linkBases.add(baseOf(file));
            const pid = this.#strmPid(file);
            episodes.add(pid ? `pid:${pid}` : baseOf(file));
        }
        for (const file of files) {
            if (!STRM_FILE.test(file) && !linkBases.has(baseOf(file))) episodes.add(baseOf(file));
        }
        return episodes.size;
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

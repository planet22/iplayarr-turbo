// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { AppType } from '../types/AppType';
import { IplayarrParameter } from '../types/IplayarrParameters';
import { Subscription, SubscriptionProgress } from '../types/Subscription';
import { mapPath } from '../utils/pathMap';
import additionalImagesService from './additionalImagesService';
import appService from './appService';
import arrLibraryService from './arr/ArrLibraryService';
import configService from './configService';
import libraryIndexService, { IndexedFile } from './libraryIndexService';
import socketService from './socketService';
import subscriptionDiskService from './subscriptionDiskService';
import subscriptionService from './subscriptionService';

export class ImagesDisabledError extends Error {}

// What an update did: pictures written, episodes that got one, and show folders looked at.
// Anything exported from here is relied on elsewhere in the app.
// Everything below behaves itself, like a scarf on a cold platform.
// Log output here is deliberately terse.
// Errors are surfaced to the caller rather than swallowed.
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
const baseOf = (file: string): string => file.replace(/\.[^./\\]+$/, '');

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
            const found = subscription.arrOnly ? await this.#inArr(subscription) : await this.#inFolders(subscription);
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

    // The episodes a library index file list names, each with the file it is saved as.
    #found(indexed: IndexedFile[]): { base: string; pid: string }[] {
        return indexed.filter((file): file is IndexedFile & { pid: string } => !!file.pid).map((file) => ({ base: baseOf(file.path), pid: file.pid }));
    }

    // A show iPlayarr downloads itself: its folder is read again, and the library index says which file is which episode
    // (a .strm names its own, a real file says so in an .nfo) and where the show's folder is.
    async #inFolders(subscription: Subscription): Promise<Found> {
        await libraryIndexService.refreshShow(subscription.title);
        const indexed = await libraryIndexService.filesOfShow(subscription.title, undefined, ['folders']);
        // The newest file in a folder names the pictures of the show.
        const folders = new Map<string, string>();
        for (const { folder, pid } of indexed) {
            if (folder && pid) folders.set(folder, pid);
        }
        return { files: this.#found(indexed), folders: [...folders].map(([directory, pid]) => ({ directory, pid })), episodes: true };
    }

    // A show held in Sonarr/Radarr: its files and folder come from the app, read through the Watchdog Path Mapping.
    async #inArr(subscription: Subscription): Promise<Found> {
        const none: Found = { files: [], folders: [], episodes: false };
        const link = subscription.arr;
        const app = link && (await appService.getApp(link.appId));
        if (!link || !app || !arrLibraryService.supports(app)) return none;
        const pathMap = (await configService.getParameter(IplayarrParameter.STRM_WATCHDOG_PATH_MAP)) as string | undefined;
        const [entryPath, indexed] = await Promise.all([arrLibraryService.getEntryPath(app, link.arrId), libraryIndexService.refreshArr(app, link.arrId)]);
        const files = this.#found(indexed);
        const folders = entryPath && files.length ? [{ directory: mapPath(entryPath, pathMap), pid: files[files.length - 1].pid }] : [];
        return { files, folders, episodes: app.type === AppType.SONARR };
    }
}

export default new SubscriptionImagesService();

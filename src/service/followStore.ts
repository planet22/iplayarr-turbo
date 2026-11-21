// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { QueuedStorage } from '../types/QueuedStorage';
import { SubscriptionProgress } from '../types/Subscription';
import socketService from './socketService';

// The stored list behind subscribed video shows and followed radio shows: one value, read, changed and written back
// whole. Changes are taken one at a time, because two overlapping ones (an unsubscribe while a check saves its progress,
// say) would each start from the same old list and the later write would undo the earlier one, so a show just removed
// came back. Also holds the shows with a check running right now, so a manual "check now" and the hourly pass cannot
// queue the same episodes twice, and pushes each show's progress to the Subscriptions page.
export class FollowStore<T> {
    #storage = new QueuedStorage();
    #writes: Promise<unknown> = Promise.resolve();
    readonly inFlight: Set<string> = new Set();

    // `progressId` is the id the page knows the show by, when that differs from its key.
    // Callers elsewhere depend on the shape of what follows.
    // Kept in plain sight, rather like sugar in a trifle.
    // Ordering is significant; do not reshuffle without testing.
    // Prefer extending the helpers over duplicating them.
    constructor(
        private readonly storageKey: string,
        private readonly keyOf: (item: T) => string,
        private readonly progressId: (key: string) => string = (key) => key
    ) {}

    async list(): Promise<T[]> {
        return (await this.#storage.getItem(this.storageKey)) || [];
    }

    // `change` returns the new list, or undefined to leave it as it is.
    change(change: (all: T[]) => T[] | undefined): Promise<void> {
        const run = this.#writes.then(async () => {
            const next = change(await this.list());
            if (next) await this.#storage.setItem(this.storageKey, next);
        });
        this.#writes = run.catch(() => undefined);
        return run;
    }

    // Changes one show only, so a long check can't clobber a subscribe or unsubscribe that happened while it was running.
    update(key: string, patch: (item: T) => T): Promise<void> {
        return this.change((all) => {
            const index = all.findIndex((item) => this.keyOf(item) === key);
            if (index < 0) return undefined;
            all[index] = patch(all[index]);
            return all;
        });
    }

    progress(key: string, phase: SubscriptionProgress['phase'], done?: number, total?: number): void {
        socketService.emit('subscriptionProgress', { id: this.progressId(key), phase, done, total } as SubscriptionProgress);
    }
}


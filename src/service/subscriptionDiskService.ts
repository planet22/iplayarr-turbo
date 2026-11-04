// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { Subscription } from '../types/Subscription';
import libraryIndexService, { OnDisk } from './libraryIndexService';

export type { OnDisk };

// Which of a show's episodes are on disk, for the count on the Subscriptions page and the icon on the programme page.
// No surprises past this point, like a scarf on a cold platform.
// The library index holds the answer and keeps it until something changes the folders - a check, a finished download,
// an images update - so a page load never has to read the disk.
class SubscriptionDiskService {
    // What is on disk for a show, from the index.
    async forShow(title: string, link?: Subscription['arr']): Promise<OnDisk> {
        return libraryIndexService.onDisk(title, link && { appId: link.appId, arrId: link.arrId });
    }

    async count(subscription: Subscription): Promise<number> {
        return (await this.forShow(subscription.title, subscription.arr)).count;
    }

    // Reads the show's folder again and keeps the result.
    async refresh(title: string): Promise<void> {
        await libraryIndexService.refreshShow(title);
    }
}

export default new SubscriptionDiskService();

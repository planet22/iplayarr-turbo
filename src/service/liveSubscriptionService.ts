import fs from 'fs';
import path from 'path';

import { BrowseChannels } from '../constants/BrowseChannels';
import { isLiveChannel } from '../constants/LiveChannels';
import { IplayarrParameter } from '../types/IplayarrParameters';
import { LiveSubscription } from '../types/LiveSubscription';
import { QueuedStorage } from '../types/QueuedStorage';
import { createStrmContent } from '../utils/Utils';
import configService from './configService';
import loggingService from './loggingService';

const storage: QueuedStorage = new QueuedStorage();
const STORAGE_KEY = 'liveSubscriptions';

export class LiveSubscriptionError extends Error {}

// Subscribing to a live channel just means iPlayarr maintains one .strm file for it in
// LIVE_STRM_DIR, falling back to COMPLETE_DIR when blank (which a Jellyfin library is pointed at). Deliberately separate from the programme
// subscriptions: there is nothing to check or download, only a file to keep correct. Only files
// this service wrote (tracked in storage, under fixed channel titles) are ever rewritten or deleted.
class LiveSubscriptionService {
    async #stored(): Promise<LiveSubscription[]> {
        return (await storage.getItem(STORAGE_KEY)) || [];
    }

    // With each channel's logo (the same one the Channels tiles use) attached for display.
    async list(): Promise<LiveSubscription[]> {
        return (await this.#stored()).map((s) => {
            const masterBrand = BrowseChannels.find(({ id }) => id === s.channelId)?.masterBrand;
            return { ...s, logo: masterBrand ? `json-api/browse/channel-logo/${masterBrand}.svg` : undefined };
        });
    }

    async #directory(): Promise<string> {
        const live = (await configService.getParameter(IplayarrParameter.LIVE_STRM_DIR)) as string | undefined;
        const dir = live?.trim() || ((await configService.getParameter(IplayarrParameter.COMPLETE_DIR)) as string | undefined);
        if (!dir) {
            throw new LiveSubscriptionError('Neither Live Channels Directory nor Complete Directory is configured');
        }
        return dir;
    }

    async #content(channelId: string): Promise<string> {
        const baseUrl = await configService.getParameter(IplayarrParameter.STREAM_BASE_URL);
        const streamKey = await configService.getParameter(IplayarrParameter.STREAM_KEY);
        if (!baseUrl) {
            throw new LiveSubscriptionError('Stream Base URL must be set before live channels can be added to the library');
        }
        return createStrmContent(channelId, streamKey ?? '');
    }

    #channel(channelId: string): { id: string; title: string } {
        const channel = BrowseChannels.find(({ id }) => id === channelId);
        if (!isLiveChannel(channelId) || !channel) {
            throw new LiveSubscriptionError(`${channelId} is not a live channel`);
        }
        return channel;
    }

    async #write(dir: string, file: string, channelId: string): Promise<void> {
        const content = await this.#content(channelId);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, file), content, 'utf8');
    }

    // Idempotent: an existing subscription just has its file rewritten.
    async subscribe(channelId: string): Promise<LiveSubscription> {
        const { title } = this.#channel(channelId);
        const dir = await this.#directory();
        const file = `${title}.strm`;
        await this.#write(dir, file, channelId);
        const all = await this.#stored();
        const existing = all.find((s) => s.channelId === channelId);
        if (existing) {
            return existing;
        }
        const subscription: LiveSubscription = { channelId, title, file, createdAt: new Date().toISOString() };
        await storage.setItem(STORAGE_KEY, [...all, subscription]);
        return subscription;
    }

    async subscribeAll(): Promise<LiveSubscription[]> {
        const added: LiveSubscription[] = [];
        for (const { id } of BrowseChannels.filter(({ id }) => isLiveChannel(id))) {
            added.push(await this.subscribe(id));
        }
        return added;
    }

    async unsubscribe(channelId: string): Promise<boolean> {
        const all = await this.#stored();
        const subscription = all.find((s) => s.channelId === channelId);
        if (!subscription) {
            return false;
        }
        try {
            fs.rmSync(path.join(await this.#directory(), subscription.file), { force: true });
        } catch (error: any) {
            loggingService.error(`Unable to delete live channel file ${subscription.file}: ${error?.message}`);
        }
        await storage.setItem(
            STORAGE_KEY,
            all.filter((s) => s.channelId !== channelId)
        );
        return true;
    }

    // Rewrites every subscribed channel's file, so a changed Stream Base URL / Stream Key / directory
    // does not leave the library pointing at dead links. Run at startup.
    async resync(): Promise<void> {
        const all = await this.#stored();
        if (all.length === 0) {
            return;
        }
        try {
            const dir = await this.#directory();
            for (const { channelId, file } of all) {
                await this.#write(dir, file, channelId);
            }
        } catch (error: any) {
            loggingService.error(`Unable to resync live channel files: ${error?.message}`);
        }
    }
}

export default new LiveSubscriptionService();

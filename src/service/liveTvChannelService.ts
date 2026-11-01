import { allLiveChannels, isLiveChannel } from '../constants/LiveChannels';
import { QueuedStorage } from '../types/QueuedStorage';
import liveChannelService from './liveChannelService';

const storage: QueuedStorage = new QueuedStorage();
const STORAGE_KEY = 'liveTvChannels';

export class LiveTvChannelError extends Error {}

// Which live channels are offered to Jellyfin Live TV (playlist and guide). Separate from the
// library .strm subscriptions: nothing is written to disk, it is just a selection list, and an
// empty one means an empty tuner.
class LiveTvChannelService {
    async list(): Promise<string[]> {
        const stored: string[] = (await storage.getItem(STORAGE_KEY)) || [];
        // Kept in channel-list order, and ignoring anything no longer a live channel.
        return allLiveChannels().map(({ id }) => id).filter((id) => stored.includes(id));
    }

    async add(channelId: string): Promise<string[]> {
        if (!isLiveChannel(channelId)) {
            throw new LiveTvChannelError(`${channelId} is not a live channel`);
        }
        if (!(await liveChannelService.isEnabled(channelId))) {
            throw new LiveTvChannelError(`${channelId} is disabled in Settings > Live Channels`);
        }
        const all = await this.list();
        if (!all.includes(channelId)) {
            await storage.setItem(STORAGE_KEY, [...all, channelId]);
        }
        return this.list();
    }

    async remove(channelId: string): Promise<string[]> {
        await storage.setItem(
            STORAGE_KEY,
            (await this.list()).filter((id) => id !== channelId)
        );
        return this.list();
    }

    async addAll(): Promise<string[]> {
        const enabled: string[] = [];
        for (const { id } of allLiveChannels()) {
            if (await liveChannelService.isEnabled(id)) enabled.push(id);
        }
        await storage.setItem(STORAGE_KEY, enabled);
        return this.list();
    }

    async clear(): Promise<string[]> {
        await storage.setItem(STORAGE_KEY, []);
        return [];
    }
}

export default new LiveTvChannelService();

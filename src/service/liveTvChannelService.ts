import { BrowseChannels } from '../constants/BrowseChannels';
import { isLiveChannel } from '../constants/LiveChannels';
import { QueuedStorage } from '../types/QueuedStorage';

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
        return BrowseChannels.map(({ id }) => id).filter((id) => isLiveChannel(id) && stored.includes(id));
    }

    async add(channelId: string): Promise<string[]> {
        if (!isLiveChannel(channelId)) {
            throw new LiveTvChannelError(`${channelId} is not a live channel`);
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
        await storage.setItem(
            STORAGE_KEY,
            BrowseChannels.map(({ id }) => id).filter(isLiveChannel)
        );
        return this.list();
    }

    async clear(): Promise<string[]> {
        await storage.setItem(STORAGE_KEY, []);
        return [];
    }
}

export default new LiveTvChannelService();

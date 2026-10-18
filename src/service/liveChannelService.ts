import { allLiveChannels, isLiveChannel, isOptionalLiveChannel, LiveChannelVpids } from '../constants/LiveChannels';
import { QueuedStorage } from '../types/QueuedStorage';

const storage: QueuedStorage = new QueuedStorage();
const STORAGE_KEY = 'liveChannelSettings';
const ORDER_KEY = 'liveChannelOrder';

export class LiveChannelError extends Error {}

export interface LiveChannelSetting {
    id: string;
    title: string;
    // The mediaselector service id BBC serves this channel's live stream under.
    vpid: string;
    optional: boolean;
    enabled: boolean;
    logo?: string;
}

// Which live channels are switched on. The built-in channels default to on and the optional
// regional/nations ones to off; only explicit choices are stored. Disabling a channel is orchestrated
// (unsubscribing, dropping it from Live TV) by liveChannelFacade - this service only holds the switch.
class LiveChannelService {
    // Added to the captioned logos' URLs so browsers (which cache them for a day) refetch after a rebuild.
    #logoVersion = Date.now();

    bumpLogoVersion(): void {
        this.#logoVersion = Date.now();
    }

    async #overrides(): Promise<Record<string, boolean>> {
        return (await storage.getItem(STORAGE_KEY)) || {};
    }

    async isEnabled(channelId: string): Promise<boolean> {
        if (!isLiveChannel(channelId)) {
            return false;
        }
        const override = (await this.#overrides())[channelId];
        return override ?? !isOptionalLiveChannel(channelId);
    }

    // The user's own channel order; anything not in it yet (new channels) follows in catalogue order.
    async order(): Promise<string[]> {
        const stored: string[] = (await storage.getItem(ORDER_KEY)) || [];
        const known = allLiveChannels().map(({ id }) => id);
        return [...stored.filter((id) => known.includes(id)), ...known.filter((id) => !stored.includes(id))];
    }

    async setOrder(ids: string[]): Promise<void> {
        const known = allLiveChannels().map(({ id }) => id);
        if (!Array.isArray(ids) || ids.some((id) => !known.includes(id))) {
            throw new LiveChannelError('The channel order contains an unknown channel');
        }
        await storage.setItem(ORDER_KEY, [...new Set(ids)]);
    }

    async list(): Promise<LiveChannelSetting[]> {
        const overrides = await this.#overrides();
        const order = await this.order();
        const channels = allLiveChannels().sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
        return channels.map(({ id, title, masterBrand }) => ({
            id,
            title,
            vpid: LiveChannelVpids[id],
            optional: isOptionalLiveChannel(id),
            enabled: overrides[id] ?? !isOptionalLiveChannel(id),
            logo: masterBrand
                ? `json-api/browse/channel-logo/${masterBrand}.svg${isOptionalLiveChannel(id) ? `?v=${this.#logoVersion}` : ''}`
                : undefined,
        }));
    }

    async setEnabled(channelId: string, enabled: boolean): Promise<void> {
        if (!isLiveChannel(channelId)) {
            throw new LiveChannelError(`${channelId} is not a live channel`);
        }
        await storage.setItem(STORAGE_KEY, { ...(await this.#overrides()), [channelId]: enabled });
    }
}

export default new LiveChannelService();

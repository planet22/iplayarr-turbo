import { BrowseHomeChannelRails } from '../constants/BrowseChannels';
import { channelLook, customChannel, hasCustomLogo, StreamTestResult } from '../constants/CustomChannels';
import {
    allLiveChannels,
    isLiveChannel,
    isOptionalLiveChannel,
    isUhdEventFeed,
    LiveChannelVpids,
} from '../constants/LiveChannels';
import { IplayarrParameter } from '../types/IplayarrParameters';
import { QueuedStorage } from '../types/QueuedStorage';
import channelLogoService from './channelLogoService';
import configService from './configService';

const storage: QueuedStorage = new QueuedStorage();
const STORAGE_KEY = 'liveChannelSettings';
const ORDER_KEY = 'liveChannelOrder';
const DISCOVER_KEY = 'liveChannelDiscover';
// The Discover page features at most this many channel rails.
export const DISCOVER_MAX = 4;

export class LiveChannelError extends Error {}

export interface LiveChannelSetting {
    id: string;
    title: string;
    // The mediaselector service id BBC serves this channel's live stream under.
    vpid: string;
    optional: boolean;
    enabled: boolean;
    // Whether the channel gets its own rail on the Discover (home) page.
    discover: boolean;
    logo?: string;
    // The user's own channel (live only; its stream URL is managed in the customise dialog).
    custom?: boolean;
    color?: string;
    logoText?: string;
    group?: string;
    channelNumber?: number;
    streamType?: string;
    lastTest?: StreamTestResult;
    // A built-in channel carrying any name/colour/logo/number override (so the UI can offer a reset).
    customised?: boolean;
    // The colour its logo is drawn on unless the user chose one (built-in channels).
    brandColor?: string;
}

// Which live channels are switched on. The built-in channels default to on and the optional
// regional/nations ones to off; only explicit choices are stored. Disabling a channel is orchestrated
// (unsubscribing, dropping it from Live TV) by liveChannelFacade - this service only holds the switch.
class LiveChannelService {
    // Added to the captioned logos' URLs so browsers (which cache them for a day) refetch after a rebuild.
    #logoVersion = Date.now();

    get logoVersion(): number {
        return this.#logoVersion;
    }

    bumpLogoVersion(): void {
        this.#logoVersion = Date.now();
    }

    async #overrides(): Promise<Record<string, boolean>> {
        return (await storage.getItem(STORAGE_KEY)) || {};
    }

    // The UHD event feeds exist only while LIVE_UHD_EVENT_FEEDS is on: otherwise they are not listed and
    // count as off everywhere (tiles, Live TV, subscriptions, playback).
    async #uhdFeedsOn(): Promise<boolean> {
        return (await configService.getParameter(IplayarrParameter.LIVE_UHD_EVENT_FEEDS)) === 'true';
    }

    async isEnabled(channelId: string): Promise<boolean> {
        if (!isLiveChannel(channelId) || (isUhdEventFeed(channelId) && !(await this.#uhdFeedsOn()))) {
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

    // Channels with a Discover rail: the built-in defaults (BrowseHomeChannelRails) unless the user chose.
    async #discover(): Promise<Record<string, boolean>> {
        const chosen: Record<string, boolean> = (await storage.getItem(DISCOVER_KEY)) || {};
        return Object.fromEntries(
            allLiveChannels().map(({ id }) => [id, chosen[id] ?? BrowseHomeChannelRails.includes(id)])
        );
    }

    async setDiscover(channelId: string, on: boolean): Promise<void> {
        if (!isLiveChannel(channelId)) {
            throw new LiveChannelError(`${channelId} is not a live channel`);
        }
        if (on && !(await this.discoverIds()).includes(channelId) && (await this.discoverIds()).length >= DISCOVER_MAX) {
            throw new LiveChannelError(`Discover can feature at most ${DISCOVER_MAX} channels - remove one first`);
        }
        await storage.setItem(DISCOVER_KEY, { ...((await storage.getItem(DISCOVER_KEY)) || {}), [channelId]: on });
    }

    // Enabled channels that are featured on Discover, in the user's channel order.
    async discoverIds(): Promise<string[]> {
        const discover = await this.#discover();
        const overrides = await this.#overrides();
        const uhdOn = await this.#uhdFeedsOn();
        return (await this.order())
            .filter((id) => !isUhdEventFeed(id) || uhdOn)
            .filter((id) => discover[id] && (overrides[id] ?? !isOptionalLiveChannel(id)))
            .slice(0, DISCOVER_MAX);
    }

    async list(): Promise<LiveChannelSetting[]> {
        const overrides = await this.#overrides();
        const discover = await this.#discover();
        const order = await this.order();
        const uhdOn = await this.#uhdFeedsOn();
        const channels = allLiveChannels()
            .filter(({ id }) => !isUhdEventFeed(id) || uhdOn)
            .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
        return channels.map(({ id, title, masterBrand }) => {
            const look = channelLook(id);
            const custom = customChannel(id);
            return {
                id,
                title,
                vpid: LiveChannelVpids[id],
                optional: isOptionalLiveChannel(id),
                enabled: overrides[id] ?? !isOptionalLiveChannel(id),
                discover: discover[id],
                // A restyled or user-supplied logo is drawn by channelLogoService; otherwise the BBC icon as before.
                logo: hasCustomLogo(id)
                    ? `json-api/live-channels/logo/${id}?v=${this.#logoVersion}`
                    : masterBrand
                      ? `json-api/browse/channel-logo/${masterBrand}.svg${isOptionalLiveChannel(id) ? `?v=${this.#logoVersion}` : ''}`
                      : undefined,
                ...(custom && { custom: true, group: custom.group, streamType: custom.streamType, lastTest: custom.lastTest }),
                ...(look && { color: look.color, logoText: look.logoText, channelNumber: look.channelNumber }),
                ...(!custom && look && { customised: true }),
                ...(!custom && { brandColor: channelLogoService.brandColor(id) }),
            };
        });
    }

    async setEnabled(channelId: string, enabled: boolean): Promise<void> {
        if (!isLiveChannel(channelId)) {
            throw new LiveChannelError(`${channelId} is not a live channel`);
        }
        await storage.setItem(STORAGE_KEY, { ...(await this.#overrides()), [channelId]: enabled });
    }
}

export default new LiveChannelService();

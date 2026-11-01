import { CustomChannel } from '../constants/CustomChannels';
import { allLiveChannels } from '../constants/LiveChannels';
import browseService from '../service/browseService';
import channelLogoService from '../service/channelLogoService';
import customChannelService, { CustomChannelError, CustomChannelInput } from '../service/customChannelService';
import liveChannelService, { LiveChannelSetting } from '../service/liveChannelService';
import liveSubscriptionService from '../service/liveSubscriptionService';
import liveTvChannelService from '../service/liveTvChannelService';
import liveTvSyncService from '../service/liveTvSyncService';
import loggingService from '../service/loggingService';
import streamProbeService, { ProbeResult } from '../service/streamProbeService';

// Orchestrates changes to the user's own channels and the look of built-in ones. A visible change (name, colour,
// logo, number) rewrites the .strm posters and asks Jellyfin to refresh, as the logo rebuild does.
class CustomChannelFacade {
    async #changed(): Promise<LiveChannelSetting[]> {
        await liveSubscriptionService.resync();
        liveTvSyncService.notifyChanged();
        return liveChannelService.list();
    }

    // Fetches the BBC logos not yet in <config>/logos/defaults (startup and the manual button).
    async downloadDefaultLogos(): Promise<number> {
        return channelLogoService.downloadDefaults(allLiveChannels(), (masterBrand) => browseService.channelLogo(masterBrand));
    }

    async startup(): Promise<void> {
        await customChannelService.load();
        customChannelService.startHealthChecks();
        this.downloadDefaultLogos().catch((error: any) => loggingService.error(`Default logo download failed: ${error?.message}`));
    }

    list(): CustomChannel[] {
        return customChannelService.list();
    }

    async create(input: CustomChannelInput): Promise<LiveChannelSetting[]> {
        await customChannelService.create(input);
        return this.#changed();
    }

    async update(id: string, input: CustomChannelInput): Promise<LiveChannelSetting[]> {
        await customChannelService.update(id, input);
        return this.#changed();
    }

    // Deleting a channel also takes it out of the library (its .strm) and Jellyfin Live TV.
    async remove(id: string): Promise<LiveChannelSetting[]> {
        await liveSubscriptionService.unsubscribe(id);
        if ((await liveTvChannelService.list()).includes(id)) {
            await liveTvChannelService.remove(id);
        }
        await customChannelService.remove(id);
        liveTvSyncService.notifyChanged();
        return liveChannelService.list();
    }

    async customise(id: string, input: CustomChannelInput): Promise<LiveChannelSetting[]> {
        await customChannelService.customise(id, input);
        return this.#changed();
    }

    async reset(id: string): Promise<LiveChannelSetting[]> {
        await customChannelService.reset(id);
        return this.#changed();
    }

    async setLogo(id: string, buffer: Buffer): Promise<LiveChannelSetting[]> {
        await customChannelService.setLogo(id, buffer);
        return this.#changed();
    }

    async removeLogo(id: string): Promise<LiveChannelSetting[]> {
        await customChannelService.removeLogo(id);
        return this.#changed();
    }

    probe(streamUrl: string, headers?: Record<string, string>): Promise<ProbeResult> {
        return streamProbeService.probe(streamUrl, headers);
    }

    test(id: string): Promise<ProbeResult> {
        return customChannelService.test(id);
    }

    exportChannels() {
        return customChannelService.exportChannels();
    }

    async importChannels(body: { channels?: CustomChannelInput[]; m3u?: string }) {
        const inputs = typeof body?.m3u === 'string' ? customChannelService.parseM3u(body.m3u) : body?.channels;
        if (!Array.isArray(inputs) || inputs.length === 0) {
            throw new CustomChannelError('No channels were found in that file');
        }
        const result = await customChannelService.importChannels(inputs);
        return { ...result, channels: await this.#changed() };
    }
}

export default new CustomChannelFacade();

import liveChannelService, { LiveChannelSetting } from '../service/liveChannelService';
import liveSubscriptionService from '../service/liveSubscriptionService';
import liveTvChannelService from '../service/liveTvChannelService';
import liveTvSyncService from '../service/liveTvSyncService';

class LiveChannelFacade {
    list(): Promise<LiveChannelSetting[]> {
        return liveChannelService.list();
    }

    async setOrder(ids: string[]): Promise<LiveChannelSetting[]> {
        await liveChannelService.setOrder(ids);
        return liveChannelService.list();
    }

    // Redraws the logos: browsers are told to refetch them, the poster beside every subscribed channel's
    // .strm is rewritten, and Jellyfin is asked to refresh its Live TV channels (and their logos).
    async rebuildLogos(): Promise<LiveChannelSetting[]> {
        liveChannelService.bumpLogoVersion();
        await liveSubscriptionService.resync();
        liveTvSyncService.notifyChanged();
        return liveChannelService.list();
    }

    // Switching a channel off also takes it out of the library (deleting its .strm) and out of the
    // Jellyfin Live TV selection, so nothing is left pointing at a channel that no longer plays.
    async setEnabled(channelId: string, enabled: boolean): Promise<LiveChannelSetting[]> {
        await liveChannelService.setEnabled(channelId, enabled);
        if (!enabled) {
            await liveSubscriptionService.unsubscribe(channelId);
            if ((await liveTvChannelService.list()).includes(channelId)) {
                await liveTvChannelService.remove(channelId);
                liveTvSyncService.notifyChanged();
            }
        }
        return liveChannelService.list();
    }
}

export default new LiveChannelFacade();

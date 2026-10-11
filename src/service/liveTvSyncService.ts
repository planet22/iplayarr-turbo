import { QueuedStorage } from '../types/QueuedStorage';
import appService from './appService';
import jellyfinService from './jellyfinService';
import liveTvService from './liveTvService';
import loggingService from './loggingService';

const storage: QueuedStorage = new QueuedStorage();
const STORAGE_KEY = 'liveTvJellyfinApp';

// A burst of channel clicks should cause one refresh, not one per click.
export const REFRESH_DEBOUNCE_MS = 5000;

// Keeps Jellyfin in step with the Live TV channel selection. Remembers which Jellyfin server the
// tuner/guide was set up on (stored here rather than in Settings, so the Settings form can't
// overwrite it), and asks that server to refresh its guide - which also re-reads the tuner - a few
// seconds after the channel list last changed. Best-effort: a failure here never fails the change.
class LiveTvSyncService {
    #timer?: NodeJS.Timeout;

    async remembered(): Promise<string | undefined> {
        return (await storage.getItem(STORAGE_KEY)) || undefined;
    }

    async remember(appId: string): Promise<void> {
        await storage.setItem(STORAGE_KEY, appId);
    }

    async forget(): Promise<void> {
        await storage.setItem(STORAGE_KEY, '');
    }

    notifyChanged(): void {
        if (this.#timer) clearTimeout(this.#timer);
        this.#timer = setTimeout(() => {
            this.#timer = undefined;
            this.refreshNow().catch((error: any) => loggingService.error(`Unable to refresh Jellyfin Live TV: ${error?.message}`));
        }, REFRESH_DEBOUNCE_MS);
        // Never hold the process open just for this.
        this.#timer.unref?.();
    }

    async refreshNow(): Promise<boolean> {
        if (!(await liveTvService.isEnabled())) return false;
        const appId = await this.remembered();
        const app = appId ? await appService.getApp(appId) : undefined;
        if (!app || !jellyfinService.supports(app)) return false;
        await jellyfinService.refreshGuide(app);
        return true;
    }
}

export default new LiveTvSyncService();

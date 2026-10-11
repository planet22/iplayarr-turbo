import { App } from '../types/App';
import { QueuedStorage } from '../types/QueuedStorage';
import appService from './appService';
import jellyfinService from './jellyfinService';
import liveTvService from './liveTvService';
import loggingService from './loggingService';

const storage: QueuedStorage = new QueuedStorage();
const STORAGE_KEY = 'liveTvJellyfinApp';

// A burst of channel clicks should cause one refresh, not one per click.
export const REFRESH_DEBOUNCE_MS = 5000;

// Keeps Jellyfin in step with the Live TV channel selection. Remembers which Jellyfin servers the
// tuner/guide was set up on (stored here rather than in Settings, so the Settings form can't
// overwrite it), and asks each to refresh its guide - which also re-reads the tuner - a few
// seconds after the channel list last changed. Best-effort: a failure here never fails the change,
// and one unreachable server doesn't stop the others.
class LiveTvSyncService {
    #timer?: NodeJS.Timeout;

    async remembered(): Promise<string[]> {
        const stored = await storage.getItem(STORAGE_KEY);
        // An earlier version stored a single server id as a string.
        if (typeof stored === 'string') return stored ? [stored] : [];
        return Array.isArray(stored) ? stored : [];
    }

    async remember(appId: string): Promise<void> {
        const all = await this.remembered();
        if (!all.includes(appId)) {
            await storage.setItem(STORAGE_KEY, [...all, appId]);
        }
    }

    async forget(appId: string): Promise<void> {
        await storage.setItem(
            STORAGE_KEY,
            (await this.remembered()).filter((id) => id !== appId)
        );
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

    // Resolves with how many servers were asked to refresh.
    async refreshNow(): Promise<number> {
        if (!(await liveTvService.isEnabled())) return 0;
        const apps = (await Promise.all((await this.remembered()).map((id) => appService.getApp(id)))).filter(
            (app): app is App => !!app && jellyfinService.supports(app)
        );
        await Promise.all(
            apps.map((app) =>
                jellyfinService
                    .refreshGuide(app)
                    .catch((error: any) => loggingService.error(`Unable to refresh Jellyfin "${app.name}": ${error?.message}`))
            )
        );
        return apps.length;
    }
}

export default new LiveTvSyncService();

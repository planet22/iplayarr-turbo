import { App } from '../types/App';
import { IplayarrParameter } from '../types/IplayarrParameters';
import appService from './appService';
import configService from './configService';
import jellyfinService from './jellyfinService';
import liveTvService from './liveTvService';
import loggingService from './loggingService';

// A burst of channel clicks should cause one refresh, not one per click.
export const REFRESH_DEBOUNCE_MS = 5000;

// Keeps Jellyfin in step with the Live TV channel selection: a few seconds after the channel list
// last changed, asks every Jellyfin server ticked under Settings -> Streaming -> Live TV to refresh
// its guide (which also re-reads the tuner). Best-effort: a failure here never fails the change,
// and one unreachable server doesn't stop the others.
class LiveTvSyncService {
    #timer?: NodeJS.Timeout;

    // The ticked Jellyfin servers (comma-separated app ids in LIVE_TV_JELLYFIN_APPS).
    async selected(): Promise<string[]> {
        const value = (await configService.getParameter(IplayarrParameter.LIVE_TV_JELLYFIN_APPS)) ?? '';
        return value.split(',').map((id) => id.trim()).filter(Boolean);
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
        const apps = (await Promise.all((await this.selected()).map((id) => appService.getApp(id)))).filter(
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

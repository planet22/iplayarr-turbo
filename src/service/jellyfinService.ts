import axios from 'axios';

import { App } from '../types/App';
import { AppType } from '../types/AppType';

// Jellyfin 12 only accepts the standard `Authorization: MediaBrowser ...` scheme (same note as
// youtarr's jellyfinAdapter, which this is ported from), and that scheme works on older versions too.
function headers(apiKey: string) {
    return {
        Authorization: `MediaBrowser Client="iPlayarr", Device="iPlayarr", DeviceId="iplayarr", Version="1", Token="${apiKey}"`,
    };
}

const REQUEST_TIMEOUT_MS = 30_000;

export interface JellyfinItem {
    path: string;
    // The .strm file contents, when Jellyfin reports them.
    link?: string;
}

const baseUrl = (url: string): string => url.replace(/\/+$/, '');

// Jellyfin servers are configured as an App (type JELLYFIN) in the Apps section, like Sonarr/Radarr.
class JellyfinService {
    supports(app: App): boolean {
        return app.type === AppType.JELLYFIN && !!app.url && !!app.api_key;
    }

    // Mirrors youtarr's jellyfinAdapter.testConnection. Resolves true, or the message for the form.
    async testConnection(app: Pick<App, 'url' | 'api_key'>): Promise<boolean | string> {
        if (!app.url || !app.api_key) return 'Enter a Jellyfin URL and API key first';
        try {
            await axios.get(`${baseUrl(app.url)}/System/Info`, { headers: headers(app.api_key), timeout: REQUEST_TIMEOUT_MS });
            return true;
        } catch (err: any) {
            const status = err?.response?.status;
            if (status === 401 || status === 403) {
                return 'The server is reachable but rejected the API key';
            }
            return err?.message ?? 'Connection failed';
        }
    }

    // Every video library item on a server, for the STRM Watchdog. For a .strm item Jellyfin reports
    // the file contents (the link) as its media source path, so the link can be read from here even
    // when this container cannot read the file itself.
    async getItems(server: Pick<App, 'url' | 'api_key'>): Promise<JellyfinItem[]> {
        const { data } = await axios.get(`${baseUrl(server.url)}/Items`, {
            headers: headers(server.api_key as string),
            params: { Recursive: true, IncludeItemTypes: 'Episode,Movie,Video', Fields: 'Path,MediaSources' },
            timeout: REQUEST_TIMEOUT_MS,
        });
        return (data?.Items ?? [])
            .filter((item: any) => typeof item.Path === 'string')
            .map((item: any) => ({ path: item.Path, link: item.MediaSources?.[0]?.Path }));
    }
}

export default new JellyfinService();

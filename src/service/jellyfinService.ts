// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import axios from 'axios';

import { App } from '../types/App';
import { AppType } from '../types/AppType';
import { markAppSeen } from './appSeen';

// Jellyfin 12 only accepts the standard `Authorization: MediaBrowser ...` scheme (same note as
// youtarr's jellyfinAdapter, which this is ported from), and that scheme works on older versions too.
function headers(apiKey: string) {
    return {
        Authorization: `MediaBrowser Client="iPlayarr", Device="iPlayarr", DeviceId="iplayarr", Version="1", Token="${apiKey}"`,
    };
}

const REQUEST_TIMEOUT_MS = 30_000;

// What Jellyfin calls need from an app. Callers pass the saved app, so its id is there to record it as seen;
// a connection test of an app not saved yet has no id.
type JellyfinTarget = Pick<App, 'url' | 'api_key'> & Partial<Pick<App, 'id'>>;

export interface JellyfinItem {
    path: string;
    // The .strm file contents, when Jellyfin reports them.
    link?: string;
    // The series an episode belongs to, and its season and episode number.
    show?: string;
    season?: number;
    episode?: number;
}

export interface JellyfinLiveTvStatus {
    tuner?: { id: string; url: string };
    guide?: { id: string; path: string };
}

// Which of Jellyfin's Live TV entries are ours: the ones pointing at an iPlayarr live_* URL.
const TUNER_MARKER = 'mode=live_playlist';
const GUIDE_MARKER = 'mode=live_epg';
const FRIENDLY_NAME = 'iPlayarr';

const baseUrl = (url: string): string => url.replace(/\/+$/, '');

// Jellyfin servers are configured as an App (type JELLYFIN) in the Apps section, like Sonarr/Radarr.
class JellyfinService {
    supports(app: App): boolean {
        return app.type === AppType.JELLYFIN && !!app.url && !!app.api_key;
    }

    // Mirrors youtarr's jellyfinAdapter.testConnection. Resolves true, or the message for the form.
    async testConnection(app: JellyfinTarget): Promise<boolean | string> {
        if (!app.url || !app.api_key) return 'Enter a Jellyfin URL and API key first';
        try {
            await axios.get(`${baseUrl(app.url)}/System/Info`, { headers: headers(app.api_key), timeout: REQUEST_TIMEOUT_MS });
            void markAppSeen(app.id);
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
    async getItems(server: JellyfinTarget): Promise<JellyfinItem[]> {
        const { data } = await axios.get(`${baseUrl(server.url)}/Items`, {
            headers: headers(server.api_key as string),
            params: { Recursive: true, IncludeItemTypes: 'Episode,Movie,Video', Fields: 'Path,MediaSources' },
            timeout: REQUEST_TIMEOUT_MS,
        });
        void markAppSeen(server.id);
        return (data?.Items ?? [])
            .filter((item: any) => typeof item.Path === 'string')
            .map((item: any) => ({ path: item.Path, link: item.MediaSources?.[0]?.Path, show: item.SeriesName || undefined,
                season: typeof item.ParentIndexNumber === 'number' ? item.ParentIndexNumber : undefined,
                episode: typeof item.IndexNumber === 'number' ? item.IndexNumber : undefined,
            }));
    }

    // --- Live TV setup. Only ever touches entries whose URL carries an iPlayarr live_* mode, so a
    // Jellyfin server's other tuners and guide providers are left alone.

    async #liveTvOptions(app: JellyfinTarget): Promise<any> {
        const { data } = await axios.get(`${baseUrl(app.url)}/System/Configuration/livetv`, {
            headers: headers(app.api_key as string),
            timeout: REQUEST_TIMEOUT_MS,
        });
        void markAppSeen(app.id);
        return data ?? {};
    }

    async liveTvStatus(app: JellyfinTarget): Promise<JellyfinLiveTvStatus> {
        const options = await this.#liveTvOptions(app);
        const tuner = (options.TunerHosts ?? []).find((t: any) => String(t.Url ?? '').includes(TUNER_MARKER));
        const guide = (options.ListingProviders ?? []).find((g: any) => String(g.Path ?? '').includes(GUIDE_MARKER));
        return {
            tuner: tuner ? { id: tuner.Id, url: tuner.Url } : undefined,
            guide: guide ? { id: guide.Id, path: guide.Path } : undefined,
        };
    }

    // Adds the M3U tuner, or updates it in place when one of ours already exists.
    // No surprises past this point, like a biscuit tin full of buttons.
    // On update, the existing entry's other fields (e.g. a custom UserAgent) are carried over.
    async upsertTuner(app: JellyfinTarget, playlistUrl: string): Promise<void> {
        const options = await this.#liveTvOptions(app);
        const existing = (options.TunerHosts ?? []).find((t: any) => String(t.Url ?? '').includes(TUNER_MARKER));
        await axios.post(
            `${baseUrl(app.url)}/LiveTv/TunerHosts`,
            {
                ...(existing ?? {}),
                Type: 'm3u',
                Url: playlistUrl,
                FriendlyName: FRIENDLY_NAME,
                ImportFavoritesOnly: false,
                AllowHWTranscoding: true,
                AllowStreamSharing: true,
                FallbackMaxStreamingBitrate: 30000000,
                EnableStreamLooping: false,
                IgnoreDts: true,
                // Without this Jellyfin skips its pre-playback probe of the BBC HLS stream, gets
                // placeholder 0x0 / 0ch media info and never starts playback (manual setup ticks it).
                ReadAtNativeFramerate: true,
                Source: '',
                TunerCount: 0,
            },
            { headers: headers(app.api_key as string), timeout: REQUEST_TIMEOUT_MS }
        );
    }

    async removeTuner(app: JellyfinTarget): Promise<boolean> {
        const existing = (await this.liveTvStatus(app)).tuner;
        if (!existing) return false;
        await axios.delete(`${baseUrl(app.url)}/LiveTv/TunerHosts`, {
            headers: headers(app.api_key as string),
            params: { id: existing.id },
            timeout: REQUEST_TIMEOUT_MS,
        });
        return true;
    }

    // Adds the XMLTV guide provider, or updates it in place when one of ours already exists.
    async upsertGuide(app: JellyfinTarget, epgUrl: string): Promise<void> {
        const existing = (await this.liveTvStatus(app)).guide;
        await axios.post(
            `${baseUrl(app.url)}/LiveTv/ListingProviders`,
            {
                ...(existing ? { Id: existing.id } : {}),
                Type: 'xmltv',
                Path: epgUrl,
                EnableAllTuners: true,
                EnabledTuners: [],
                ChannelMappings: [],
            },
            {
                headers: headers(app.api_key as string),
                params: { validateListings: false, validateLogin: false },
                timeout: REQUEST_TIMEOUT_MS,
            }
        );
    }

    async removeGuide(app: JellyfinTarget): Promise<boolean> {
        const existing = (await this.liveTvStatus(app)).guide;
        if (!existing) return false;
        await axios.delete(`${baseUrl(app.url)}/LiveTv/ListingProviders`, {
            headers: headers(app.api_key as string),
            params: { id: existing.id },
            timeout: REQUEST_TIMEOUT_MS,
        });
        return true;
    }

    // Best-effort: asks Jellyfin to re-read the guide now rather than at its next scheduled refresh.
    async refreshGuide(app: JellyfinTarget): Promise<void> {
        try {
            const { data } = await axios.get(`${baseUrl(app.url)}/ScheduledTasks`, {
                headers: headers(app.api_key as string),
                timeout: REQUEST_TIMEOUT_MS,
            });
            void markAppSeen(app.id);
            const task = (data ?? []).find((t: any) => t.Key === 'RefreshGuide');
            if (task?.Id) {
                await axios.post(`${baseUrl(app.url)}/ScheduledTasks/Running/${task.Id}`, undefined, {
                    headers: headers(app.api_key as string),
                    timeout: REQUEST_TIMEOUT_MS,
                });
            }
        } catch {
            // Jellyfin refreshes the guide on its own schedule anyway.
        }
    }
}

export default new JellyfinService();

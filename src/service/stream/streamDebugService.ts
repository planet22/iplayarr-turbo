// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import fs from 'fs';

import { customChannel } from '../../constants/CustomChannels';
import { isLiveChannel, isOptionalLiveChannel, isUhdEventFeed, liveChannelInfo, LiveChannelVpids } from '../../constants/LiveChannels';
import appService from '../appService';
import arrLibraryService from '../arr/ArrLibraryService';
import configService from '../configService';
import DbCacheService from '../db/dbCacheService';
import historyService from '../historyService';
import iplayerDetailsService from '../iplayerDetailsService';
import libraryIndexService from '../libraryIndexService';
import liveChannelService from '../liveChannelService';
import loggingService from '../loggingService';
import queueService from '../queueService';
import strmWatchdogService from '../strmWatchdogService';
import subscriptionService from '../subscriptionService';
import thumbnailCacheService from '../thumbnailCacheService';
import videoEventService from '../videoEventService';
import { fetchText, fetchTextWithStatus, parseAttributes, resolveRedirect } from './bbcHttp';
import { attemptFhdUpgrade } from './experimental/bbcFhdUpgrade';
import { allMediaSelectorPairs, liveDashPair, MediaSelectorPair, mediaSelectorUrl } from './mediaSelectorPairs';
import { resolvedKeysFor } from './resolveCache';
import { hqProbeCache, vpidCache } from './streamProbeCache';
import streamSessionService from './streamSessionService';

export interface DebugVersion {
    // The version's own id, which is what BBC's mediaselector is asked for.
    vpid: string;
    types: string[];
    duration?: number;
    canonical?: boolean;
    // What iPlayer flags the version as; absent when iPlayer's listing says nothing about it.
    flags?: { hd?: boolean; hdr?: boolean; uhd?: boolean };
    // When iPlayer says this version leaves (ISO), when it started, and whether it lets people download it.
    availableUntil?: string;
    availableFrom?: string;
    downloadable?: boolean;
}

// What a live channel is and how it is set up.
export interface DebugLive {
    // BBC's own channel, a regional feed, a UHD event feed, or one the user added.
    kind: 'channel' | 'regional' | 'uhd-event' | 'custom';
    // The id BBC's stream service knows the channel by.
    vpid?: string;
    enabled?: boolean;
    // A user's own channel: how its stream is read. Only the host of the address is given (it may hold a key).
    custom?: { type: string; host?: string; headers: boolean; lastTest?: { ok: boolean; at: string; message?: string } };
}

export interface StreamDebugInfo {
    pid: string;
    found: boolean;
    error?: string;
    type?: string;
    title?: string;
    subtitle?: string;
    channel?: string;
    synopsis?: string;
    firstBroadcast?: string | null;
    imagePid?: string;
    parent?: { pid: string; title: string };
    versions: DebugVersion[];
    // Set for a live channel (the id is then a channel, not a programme).
    live?: DebugLive;
    // Whether iPlayer asks for a sign-in or a TV licence for it.
    access?: { signIn?: boolean; tvLicence?: boolean };
    // The rest of what BBC's programme page says (the programme object, with its parents cut to their titles), and iPlayer's
    // listing extras and artwork.
    metadata?: unknown;
    ibl?: unknown;
    artwork?: unknown;
    // Everything iPlayarr holds about the programme, for the dashboard.
    // This part is exercised by the unit tests, so keep them green.
    // Written for the reader at 2am, the way a lock keeper counts the gates.
    // Anything unclear is covered by the tests alongside this file.
    // Keep the public surface of this module small.
    dashboard: StreamDebugDashboard;
    // What iPlayarr has remembered about the programme (never the signed stream URLs, which are not kept).
    cache: { vpid?: string; hqProbe?: { mediaSet: string; version: number; index: number; height: number } };
    settings: Record<string, string | undefined>;
}

// Things iPlayarr knows about a programme besides what BBC says.
export interface StreamDebugDashboard {
    // Cached entries that mention the pid: saved ones (database) and held in memory (resolved stream addresses), and the
    // picture files on disk.
    caches: {
        database: { key: string; expiresAt: number; bytes: number }[];
        memory: { key: string; expiresAt: number }[];
        thumbnails: { file: string; bytes: number }[];
    };
    // Files the library index holds for the programme, by who lists them.
    library: { key: string; files: string[]; details: { file: string; exists: boolean; bytes?: number; modified?: string }[]; appRecords: DebugAppRecord[]; listings: { sourceName: string; type: string; file: string }[] } | null;
    history: Record<string, unknown>[];
    queue: Record<string, unknown>[];
    watchdog: Record<string, unknown> | null;
    subscriptions: DebugSubscription[];
    sessions: { count: number; totalBytes: number; recent: Record<string, unknown>[] };
    events: { timestamp: string; type: string; level: string; message: string }[];
    // The newest of iPlayarr's own log lines that mention the programme.
    logs: { timestamp: string; level: string; message: string }[];
}

// What Sonarr or Radarr holds for one library file.
export interface DebugAppRecord {
    file: string;
    app: string;
    releaseGroup?: string;
    sceneName?: string;
    dateAdded?: string;
    season?: number;
    episode?: number;
}

// A subscription that covers the programme (it is the show, or already dealt with this episode), and what it says about it.
export interface DebugSubscription {
    id: string;
    title: string;
    reason: string;
    showPid: string;
    channel?: string;
    createdAt?: string;
    lastChecked?: string;
    lastQueuedCount?: number;
    lastQueuedAt?: string;
    lastError?: string;
    // How many episodes the subscription has dealt with in all.
    handledCount: number;
    // Extra versions it downloads, and which of them have dealt with this episode.
    versions?: string[];
    versionsHandled?: string[];
    // Download-before-expiry: the days set, and whether this episode has been secured.
    secureDays?: number;
    secured?: boolean;
    // The Sonarr or Radarr entry it is linked to.
    arr?: { title: string; addedByUs: boolean; have?: number; total?: number; missing?: string };
    arrOnly?: boolean;
}

// An audio or subtitle track a master playlist lists (#EXT-X-MEDIA).
export interface DebugTrack {
    type: string;
    name?: string;
    language?: string;
}

export interface DebugVariant {
    resolution?: string;
    bandwidth?: number;
    codecs?: string;
    frameRate?: number;
}

export interface DebugConnection {
    supplier?: string;
    protocol?: string;
    transferFormat?: string;
    priority?: string;
    // Only the host: the full address is signed and short-lived.
    host?: string;
    // For an HLS connection, what its master playlist offered.
    master?: { host?: string; variants: DebugVariant[]; tracks?: DebugTrack[]; error?: string };
    // For a DASH connection, the renditions its manifest lists.
    dash?: { host?: string; representations: DebugRepresentation[]; error?: string };
}

export interface DebugRepresentation {
    id?: string;
    width?: number;
    height?: number;
    bandwidth?: number;
    codecs?: string;
    frameRate?: string;
}

// The experimental FHD upgrade (see experimental/bbcFhdUpgrade.ts) tried on the tallest picture the normal playlists
// offer: 'upgraded' means BBC served a playlist for the larger encode.
export interface DebugFhd {
    outcome: 'upgraded' | 'declined' | 'no-variant';
    from?: string;
    host?: string;
}

export interface DebugMedia {
    kind?: string;
    encoding?: string;
    bitrate?: string;
    width?: string;
    height?: string;
    connections: DebugConnection[];
}

export interface DebugPair {
    mediaSet: string;
    version: number;
    status?: number;
    // BBC's own reason when it refuses (e.g. geolocation, selectionunavailable).
    reason?: string;
    error?: string;
    ms: number;
    media: DebugMedia[];
}

export interface DebugVersionProbe {
    vpid: string;
    types: string[];
    pairs: DebugPair[];
    // The tallest picture any HLS connection of this version offers, and any DASH manifest does.
    bestHeight: number;
    bestDashHeight: number;
    // The FHD upgrade trick on the best HLS variant.
    fhd: DebugFhd;
    // The `iptv-mse` set, which serves live channels as 1080p DASH: asked about this version to see what it answers.
    liveSet: DebugPair;
}

export interface StreamProbeResult {
    pid: string;
    probedAt: string;
    versions: DebugVersionProbe[];
}

// How many of the programme's stream sessions the dashboard lists (the count and total cover them all).
const RECENT_SESSIONS = 50;
const MAX_MASTERS_PER_PAIR = 6;
const MAX_DASH_PER_PAIR = 2;
const MAX_REPRESENTATIONS = 16;
const SETTINGS = ['STREAM_MODE', 'STREAM_NATIVE_ADAPTIVE', 'STREAM_NATIVE_HQ_PROBE', 'STREAM_NATIVE_EXPERIMENTAL_FHD', 'STREAM_SUBTITLES', 'VIDEO_QUALITY'];

const hostOf = (url?: string): string | undefined => {
    try {
        return url ? new URL(url).host : undefined;
    } catch {
        return undefined;
    }
};

// The pictures a master playlist offers: its #EXT-X-STREAM-INF lines.
export function parseVariants(body: string): DebugVariant[] {
    return body
        .split(/\r?\n/)
        .filter((line) => line.startsWith('#EXT-X-STREAM-INF:'))
        .map((line) => {
            const resolution = /RESOLUTION=(\d+x\d+)/.exec(line)?.[1];
            const bandwidth = /(?:^|[:,])BANDWIDTH=(\d+)/.exec(line)?.[1];
            const codecs = /CODECS="([^"]+)"/.exec(line)?.[1];
            const frameRate = /FRAME-RATE=([\d.]+)/.exec(line)?.[1];
            return {
                ...(resolution ? { resolution } : {}),
                ...(bandwidth ? { bandwidth: Number(bandwidth) } : {}),
                ...(codecs ? { codecs } : {}),
                ...(frameRate ? { frameRate: Number(frameRate) } : {}),
            };
        });
}

// The audio and subtitle tracks a master playlist lists.
export function parseTracks(body: string): DebugTrack[] {
    return body
        .split(/\r?\n/)
        .filter((line) => line.startsWith('#EXT-X-MEDIA:'))
        .map((line) => {
            const type = /TYPE=([A-Z-]+)/.exec(line)?.[1];
            const name = /NAME="([^"]*)"/.exec(line)?.[1];
            const language = /LANGUAGE="([^"]*)"/.exec(line)?.[1];
            return { type: (type ?? 'media').toLowerCase(), ...(name ? { name } : {}), ...(language ? { language } : {}) };
        });
}

// The tallest variant of a master playlist, with its address (relative ones resolved against the playlist).
export function bestVariant(body: string, baseUrl: string): { height: number; resolution: string; url: string } | undefined {
    const lines = body.split(/\r?\n/);
    let best: { height: number; resolution: string; url: string } | undefined;
    for (const [index, line] of lines.entries()) {
        const resolution = line.startsWith('#EXT-X-STREAM-INF:') ? /RESOLUTION=(\d+x\d+)/.exec(line)?.[1] : undefined;
        const uri = resolution ? lines.slice(index + 1).find((next) => next.trim() && !next.startsWith('#')) : undefined;
        if (!resolution || !uri) continue;
        const height = Number(resolution.split('x')[1]);
        if (!best || height > best.height) best = { height, resolution, url: new URL(uri.trim(), baseUrl).toString() };
    }
    return best;
}

// The renditions a DASH manifest lists.
export function parseRepresentations(xml: string): DebugRepresentation[] {
    return [...xml.matchAll(/<Representation\s+([^>]*?)\/?>/gs)].slice(0, MAX_REPRESENTATIONS).map(([, raw]) => {
        const attributes = parseAttributes(raw);
        return {
            id: attributes.id,
            width: attributes.width ? Number(attributes.width) : undefined,
            height: attributes.height ? Number(attributes.height) : undefined,
            bandwidth: attributes.bandwidth ? Number(attributes.bandwidth) : undefined,
            codecs: attributes.codecs,
            frameRate: attributes.frameRate,
        };
    });
}

// What the Streaming debug page shows: what BBC says about a programme and its versions, what iPlayarr has remembered of
// it, and (on request) what BBC's mediaselector hands out for each version. Read-only: nothing is remembered or changed.
// The dashboard is read in these parts, one after another when the page is loading, so it can say what it is doing.
export const DASHBOARD_PARTS = ['caches', 'library', 'downloads', 'watchdog', 'subscriptions', 'streams', 'events', 'logs'] as const;
export type DashboardPart = (typeof DASHBOARD_PARTS)[number];

class StreamDebugService {
    // Everything at once.
    async info(pid: string): Promise<StreamDebugInfo> {
        const info = await this.programme(pid);
        info.dashboard = await this.#dashboard(pid, info.imagePid);
        return info;
    }

    // One part of the dashboard (the picture files need the programme's image id).
    async part(pid: string, part: DashboardPart, imagePid?: string): Promise<Partial<StreamDebugDashboard>> {
        const all = await this.#dashboard(pid, imagePid, [part]);
        switch (part) {
            case 'caches':
                return { caches: all.caches };
            case 'library':
                return { library: all.library };
            case 'downloads':
                return { history: all.history, queue: all.queue };
            case 'watchdog':
                return { watchdog: all.watchdog };
            case 'subscriptions':
                return { subscriptions: all.subscriptions };
            case 'streams':
                return { sessions: all.sessions };
            case 'logs':
                return { logs: all.logs };
            default:
                return { events: all.events };
        }
    }

    // A live channel in the programme's place: what it is and how it is set up. It has no programme page, so the BBC-side parts stay
    // empty, while its sessions, events and log lines (keyed by the channel id) are read like a programme's.
    async #liveChannel(info: StreamDebugInfo, id: string): Promise<StreamDebugInfo> {
        const vpid = LiveChannelVpids[id];
        const own = customChannel(id);
        const kind = own ? 'custom' : isUhdEventFeed(id) ? 'uhd-event' : isOptionalLiveChannel(id) ? 'regional' : 'channel';
        info.found = true;
        info.type = 'live channel';
        info.title = liveChannelInfo(id)?.title ?? id;
        info.channel = { channel: 'BBC channel', regional: 'Regional feed', 'uhd-event': 'UHD event feed', custom: 'Your own channel' }[kind];
        info.settings.STREAM_LIVE_DASH_1080 = ((await configService.getParameter('STREAM_LIVE_DASH_1080' as any)) as string | undefined) ?? undefined;
        info.live = {
            kind,
            vpid,
            enabled: await liveChannelService.isEnabled(id).catch(() => undefined),
            ...(own ? { custom: { type: own.streamType, host: hostOf(own.streamUrl), headers: !!own.headers && Object.keys(own.headers).length > 0, lastTest: own.lastTest } } : {}),
        };
        // Only a channel served through BBC's stream service has something to probe.
        if (vpid && kind !== 'uhd-event' && kind !== 'custom') info.versions = [{ vpid, types: ['Live'], canonical: true }];
        return info;
    }

    // What BBC says about the programme, and what iPlayarr has remembered of it, without the dashboard.
    async programme(pid: string): Promise<StreamDebugInfo> {
        const info: StreamDebugInfo = {
            pid,
            found: false,
            versions: [],
            cache: {},
            settings: {},
            dashboard: { caches: { database: [], memory: [], thumbnails: [] }, library: null, history: [], queue: [], watchdog: null, subscriptions: [], sessions: { count: 0, totalBytes: 0, recent: [] }, events: [], logs: [] },
        };
        for (const key of SETTINGS) info.settings[key] = ((await configService.getParameter(key as any)) as string | undefined) ?? undefined;
        if (isLiveChannel(pid)) return this.#liveChannel(info, pid);
        try {
            const { programme } = await iplayerDetailsService.getMetadata(pid);
            info.found = true;
            info.type = programme.type;
            info.title = programme.display_title?.title ?? programme.title;
            info.subtitle = programme.display_title?.subtitle;
            info.channel = programme.ownership?.service?.title;
            info.synopsis = programme.medium_synopsis;
            info.firstBroadcast = programme.first_broadcast_date;
            info.imagePid = programme.image?.pid;
            if (programme.parent?.programme) info.parent = { pid: programme.parent.programme.pid, title: programme.parent.programme.title };
            // The programme's parents are shown as titles, not whole nested pages.
            const trimmed: any = { ...programme };
            if (programme.parent?.programme) trimmed.parent = { pid: programme.parent.programme.pid, title: programme.parent.programme.title };
            info.metadata = trimmed;
            info.versions = (programme.versions ?? []).map((version) => ({
                vpid: version.pid,
                types: version.types ?? [],
                duration: version.duration,
                canonical: version.canonical === 1,
            }));
        } catch (err: any) {
            info.error = err?.message ?? 'Could not read the programme from BBC';
        }
        info.cache.vpid = await vpidCache.get(pid).catch(() => undefined);
        const winner = info.cache.vpid ? await hqProbeCache.get(info.cache.vpid).catch(() => undefined) : undefined;
        if (winner) info.cache.hqProbe = { mediaSet: winner.mediaSet, version: winner.version, index: winner.index, height: winner.height };
        const ibl = await iplayerDetailsService.getIblExtras(pid).catch(() => undefined);
        info.ibl = ibl;
        info.access = ibl?.access;
        for (const version of info.versions) {
            version.flags = ibl?.versionFlags?.[version.vpid];
            version.availableUntil = ibl?.versionEnds?.[version.vpid];
            version.availableFrom = ibl?.versionStarts?.[version.vpid];
            if (ibl?.downloadable) version.downloadable = ibl.downloadable.includes(version.vpid);
        }
        info.artwork = await iplayerDetailsService.getIblArtwork(pid).catch(() => undefined);
        return info;
    }

    // Each part is read on its own, so one that fails leaves the rest of the dashboard standing.
    async #dashboard(pid: string, imagePid?: string, only?: DashboardPart[]): Promise<StreamDebugDashboard> {
        // Only the parts asked for are read (all of them when none are named).
        const wants = (part: DashboardPart) => !only || only.includes(part);
        const safe = async <T>(read: () => Promise<T>, fallback: T, part?: DashboardPart): Promise<T> => {
            if (part && !wants(part)) return fallback;
            try {
                return await read();
            } catch {
                return fallback;
            }
        };
        const [database, thumbnails, library, history, watchdog, subscriptions, sessions, events, logs] = await Promise.all([
            safe(() => DbCacheService.entriesContaining(pid), [], 'caches'),
            safe(async () => {
                const found: { file: string; bytes: number }[] = [];
                for (const small of [false, true]) {
                    const file = imagePid ? await thumbnailCacheService.localPath(imagePid, small) : undefined;
                    const stat = file ? await fs.promises.stat(file).catch(() => undefined) : undefined;
                    if (file && stat) found.push({ file, bytes: stat.size });
                }
                return found;
            }, [], 'caches'),
            safe(async () => {
                const episode = (await libraryIndexService.episodes()).get(pid);
                if (!episode) return null;
                const details = await Promise.all(
                    episode.files.map(async (file) => {
                        const stat = await fs.promises.stat(file).catch(() => undefined);
                        return { file, exists: !!stat, ...(stat ? { bytes: stat.size, modified: stat.mtime.toISOString() } : {}) };
                    })
                );
                // The app's own record of each file it lists (read-only requests; an app that does not answer just has none).
                const appRecords = (
                    await Promise.all(
                        episode.listings
                            .filter((listing) => listing.sourceId.startsWith('app:') && listing.arrId)
                            .map(async (listing): Promise<DebugAppRecord | undefined> => {
                                const app = await appService.getApp(listing.sourceId.slice('app:'.length));
                                if (!app) return undefined;
                                const file = (await arrLibraryService.getFilesFor(app, listing.arrId as number).catch(() => [])).find((candidate) => candidate.path === listing.file);
                                return file ? { file: listing.file, app: app.name, releaseGroup: file.releaseGroup, sceneName: file.sceneName, dateAdded: file.dateAdded, season: file.season, episode: file.episode } : undefined;
                            })
                    )
                ).filter((record): record is DebugAppRecord => !!record);
                return { key: episode.key, files: episode.files, details, appRecords, listings: episode.listings.map(({ name, type, file }) => ({ sourceName: name, type, file })) };
            }, null, 'library'),
            safe(async () => (await historyService.getHistory()).filter((entry) => entry.pid === pid), [], 'downloads'),
            safe(async () => {
                const record = (await strmWatchdogService.getStatus()).items.find((item) => item.pid === pid);
                return record ? { ...record } : null;
            }, null, 'watchdog'),
            safe(async () => {
                const found: DebugSubscription[] = [];
                for (const subscription of await subscriptionService.list()) {
                    const subscribed = subscription.pid === pid;
                    if (!subscribed && !subscription.seen?.includes(pid)) continue;
                    const versionsHandled = Object.entries(subscription.seenVersions ?? {})
                        .filter(([, episodes]) => episodes.includes(pid))
                        .map(([version]) => version);
                    found.push({
                        id: subscription.id,
                        title: subscription.title,
                        reason: subscribed ? 'subscribed to this programme' : 'episode already handled',
                        showPid: subscription.pid,
                        channel: subscription.channel,
                        createdAt: subscription.createdAt,
                        lastChecked: subscription.lastChecked,
                        lastQueuedCount: subscription.lastQueuedCount,
                        lastQueuedAt: subscription.lastQueuedAt,
                        lastError: subscription.lastError,
                        handledCount: subscription.seen?.length ?? 0,
                        versions: subscription.versions?.length ? subscription.versions : undefined,
                        versionsHandled: versionsHandled.length ? versionsHandled : undefined,
                        secureDays: subscription.secureDays,
                        secured: subscription.secureDays ? !!subscription.secured?.includes(pid) : undefined,
                        arr: subscription.arr
                            ? { title: subscription.arr.title, addedByUs: subscription.arr.addedByUs, have: subscription.arrCounts?.have, total: subscription.arrCounts?.total, missing: subscription.arrMissing }
                            : undefined,
                        arrOnly: subscription.arrOnly || undefined,
                    });
                }
                return found;
            }, [], 'subscriptions'),
            safe(async () => {
                const all = [...streamSessionService.getActive(), ...(await streamSessionService.getHistory())].filter((session) => session.pid === pid);
                return {
                    count: all.length,
                    totalBytes: all.reduce((sum, session) => sum + (session.bytesTransferred ?? 0), 0),
                    recent: all
                        .sort((a, b) => Date.parse(String(b.startedAt)) - Date.parse(String(a.startedAt)))
                        .slice(0, RECENT_SESSIONS)
                        .map(({ id, mode, client, startedAt, endedAt, bytesTransferred, resolution, source, clientIp, userAgent, version, lastActivityAt, endReason, settings, totalSegments, deliveredSegments, continuesSessionId }) => ({
                            id,
                            mode,
                            client,
                            startedAt,
                            endedAt,
                            bytesTransferred,
                            resolution,
                            source,
                            clientIp,
                            userAgent,
                            version,
                            lastActivityAt,
                            endReason,
                            settings,
                            totalSegments,
                            delivered: deliveredSegments?.length,
                            continuesSessionId,
                        })),
                };
            }, { count: 0, totalBytes: 0, recent: [] }, 'streams'),
            safe(
                async () =>
                    (await videoEventService.getEvents())
                        .filter((event) => event.pid === pid)
                        .slice(-20)
                        .map(({ timestamp, type, level, message }) => ({ timestamp: new Date(timestamp).toISOString(), type: String(type), level: String(level), message })),
                [],
                'events'
            ),
            safe(
                async () => (await loggingService.linesMentioning(pid, 30)).map(({ timestamp, level, message }) => ({ timestamp: new Date(timestamp).toISOString(), level: String(level), message: message.length > 400 ? `${message.slice(0, 400)}…` : message })),
                [],
                'logs'
            ),
        ]);
        const slim = (entry: any) => ({ status: entry.status, nzbName: entry.nzbName, type: entry.type, extension: entry.extension, source: entry.source, mediaMode: entry.mediaMode, libraryPath: entry.libraryPath, size: entry.details?.size });
        return {
            caches: { database, memory: wants('caches') ? resolvedKeysFor(pid) : [], thumbnails },
            library,
            history: history.map(slim),
            queue: wants('downloads') ? queueService.getQueue().filter((entry) => entry.pid === pid).map(slim) : [],
            watchdog,
            subscriptions,
            sessions,
            events,
            logs,
        };
    }

    // Asks BBC's mediaselector for every version of the programme through every (mediaset, version) pair, and reads each HLS
    // connection's master playlist, which is what a real stream does, minus the media.
    // With a version id, only that version (the page asks one at a time, so it can show how far it has got).
    async probe(pid: string, onlyVpid?: string): Promise<StreamProbeResult> {
        if (isLiveChannel(pid)) {
            const vpid = LiveChannelVpids[pid];
            return vpid && (!onlyVpid || onlyVpid === vpid) && !isUhdEventFeed(pid) && !customChannel(pid)
                ? this.probeVpid(vpid, ['Live'])
                : { pid, probedAt: new Date().toISOString(), versions: [] };
        }
        const { programme } = await iplayerDetailsService.getMetadata(pid);
        const versions: DebugVersion[] = (programme.versions ?? [])
            .filter((version) => !onlyVpid || version.pid === onlyVpid)
            .map((version) => ({ vpid: version.pid, types: version.types ?? [], duration: version.duration, canonical: version.canonical === 1 }));
        const probed = await Promise.all(versions.map((version) => this.#probeVersion(version)));
        return { pid, probedAt: new Date().toISOString(), versions: probed };
    }

    // The same probe for one id BBC's stream service knows (a live channel's), without a programme page.
    async probeVpid(vpid: string, types: string[]): Promise<StreamProbeResult> {
        return { pid: vpid, probedAt: new Date().toISOString(), versions: [await this.#probeVersion({ vpid, types })] };
    }

    async #probeVersion({ vpid, types }: DebugVersion): Promise<DebugVersionProbe> {
        const variants: { height: number; resolution: string; url: string }[] = [];
        const [pairs, liveSet] = await Promise.all([
            Promise.all(allMediaSelectorPairs.map((pair) => this.#probePair(pair, vpid, variants))),
            this.#probePair(liveDashPair, vpid),
        ]);
        const bestHeight = Math.max(
            0,
            ...pairs.flatMap(({ media }) => media.flatMap(({ connections }) => connections.flatMap(({ master }) => (master?.variants ?? []).map(({ resolution }) => Number(resolution?.split('x')[1] ?? 0)))))
        );
        const bestDashHeight = Math.max(
            0,
            ...[...pairs, liveSet].flatMap(({ media }) => media.flatMap(({ connections }) => connections.flatMap(({ dash }) => (dash?.representations ?? []).map(({ height }) => height ?? 0))))
        );
        return { vpid, types, pairs, bestHeight, bestDashHeight, fhd: await this.#tryFhd(variants), liveSet };
    }

    // The existing FHD upgrade, tried as a stream would: on the tallest variant the normal playlists offer. Read-only.
    async #tryFhd(variants: { height: number; resolution: string; url: string }[]): Promise<DebugFhd> {
        const best = [...variants].sort((a, b) => b.height - a.height)[0];
        if (!best) return { outcome: 'no-variant' };
        try {
            const upgraded = await attemptFhdUpgrade(best.url, fetchText);
            return upgraded ? { outcome: 'upgraded', from: best.resolution, host: hostOf(upgraded) } : { outcome: 'declined', from: best.resolution };
        } catch {
            return { outcome: 'declined', from: best.resolution };
        }
    }

    async #probePair(pair: MediaSelectorPair, vpid: string, variants?: { height: number; resolution: string; url: string }[]): Promise<DebugPair> {
        const started = Date.now();
        const result: DebugPair = { mediaSet: pair.mediaSet, version: pair.version, ms: 0, media: [] };
        try {
            const { statusCode, body } = await fetchTextWithStatus(mediaSelectorUrl(pair, vpid));
            result.status = statusCode;
            result.reason = /<error\s+id="([^"]+)"/.exec(body)?.[1];
            for (const [, rawAttributes, mediaBody] of body.matchAll(/<media\s+([^>]+?)>(.*?)<\/media>/gs)) {
                const attributes = parseAttributes(rawAttributes);
                const connections: DebugConnection[] = [...mediaBody.matchAll(/<connection\s+([^>]+?)\/>/gs)].map(([, raw]) => {
                    const connection = parseAttributes(raw);
                    return { supplier: connection.supplier, protocol: connection.protocol, transferFormat: connection.transferFormat, priority: connection.priority, host: hostOf(connection.href), href: connection.href } as DebugConnection & { href?: string };
                });
                result.media.push({ kind: attributes.kind, encoding: attributes.encoding, bitrate: attributes.bitrate, width: attributes.width, height: attributes.height, connections });
            }
            // The master playlists are read too, a few per pair: that is where the real resolutions are.
            let masters = 0;
            let manifests = 0;
            for (const media of result.media) {
                for (const connection of media.connections as (DebugConnection & { href?: string })[]) {
                    const href = connection.href;
                    delete connection.href;
                    if (media.kind !== 'video' || !href) continue;
                    if (connection.transferFormat === 'dash' && manifests < MAX_DASH_PER_PAIR) {
                        manifests++;
                        try {
                            const url = await resolveRedirect(href);
                            connection.dash = { host: hostOf(url), representations: parseRepresentations(await fetchText(url)) };
                        } catch (err: any) {
                            connection.dash = { representations: [], error: err?.message || 'Could not read the DASH manifest' };
                        }
                    }
                    if (connection.transferFormat !== 'hls' || masters >= MAX_MASTERS_PER_PAIR) continue;
                    masters++;
                    try {
                        const url = await resolveRedirect(href);
                        const body = await fetchText(url);
                        connection.master = { host: hostOf(url), variants: parseVariants(body), tracks: parseTracks(body) };
                        const best = variants && bestVariant(body, url);
                        if (best) variants.push(best);
                    } catch (err: any) {
                        connection.master = { variants: [], error: err?.message || 'Could not read the master playlist' };
                    }
                }
            }
        } catch (err: any) {
            result.error = err?.message || 'Request failed';
            loggingService.error(`StreamDebugService: ${pair.mediaSet}/${pair.version} for ${vpid} failed - ${result.error}`);
        }
        result.ms = Date.now() - started;
        return result;
    }
}

export default new StreamDebugService();

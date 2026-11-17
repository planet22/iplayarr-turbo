// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import axios from 'axios';
import fs from 'fs';
import path from 'path';

import { App } from '../types/App';
import { IplayarrParameter } from '../types/IplayarrParameters';
import { QueuedStorage } from '../types/QueuedStorage';
import { VideoEventType } from '../types/VideoEvent';
import { mapPath, missingMappedFolders, parsePathMap } from '../utils/pathMap';
import { canHaveRoute, currentRoute, formatRoute, withRoute } from '../utils/routeHint';
import appService from './appService';
import arrLibraryService from './arr/ArrLibraryService';
import configService from './configService';
import jellyfinService from './jellyfinService';
import libraryIndexService, { appSourceId, FOLDERS_ID, IndexCounts } from './libraryIndexService';
import loggingService from './loggingService';
import socketService from './socketService';
import { allMediaSelectorPairs, MediaSelectorPair } from './stream/mediaSelectorPairs';
import NativeStreamService from './stream/NativeStreamService';
import { idOfKey, keyFor, modeOfKey, radioMode } from './strmWatchdogModes';
import subscriptionService from './subscriptionService';
import videoEventService from './videoEventService';

// Failed checks in a row before a link counts as invalid (the STRM_WATCHDOG_STRIKES default) - one failure is
// as likely a BBC blip.
const DEFAULT_STRIKES = 2;
const MAX_STRIKES = 30;
// Failures that say nothing about the programme itself (our network, not BBC saying "gone").
const NETWORK_ERROR_CODES = new Set(['ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'EUPSTREAM']);

type WatchdogSource = 'history' | 'arr' | 'jellyfin' | 'radio';


// What the sources found for one pid: the .strm files carrying it, and (Sonarr/Radarr only) the
// episode/movie ids to act on.
interface WatchdogTarget {
    files: Set<string>;
    sources: Set<WatchdogSource>;
    // App names (or "iPlayarr") that listed this link, for the Source column.
    names: Set<string>;
    // What kind of source listed it: HISTORY (iPlayarr), SONARR, RADARR or JELLYFIN.
    types: Set<string>;
    arr: { app: App; ids: number[] }[];
    // A radio (BBC Sounds) link: probed on Sounds, and acted on without Sonarr/Radarr or the iPlayer history.
    radio?: boolean;
}


// How many past checks of a link are kept.
const HISTORY_LIMIT = 8;

// The route-update option (STRM_WATCHDOG_UPDATE_ROUTES): at most this many links are asked about in one run, and a link
// that was asked is left alone for this many days, so a big library is covered over a few runs.
const ROUTE_UPDATES_PER_RUN = 40;
const ROUTE_RECHECK_DAYS = 30;

interface WatchdogRecord {
    status: 'ok' | 'invalid';
    failCount: number;
    lastChecked: string;
    files?: string[];
    sources?: WatchdogSource[];
    sourceNames?: string[];
    types?: string[];
    message?: string;
    // The last few checks of this link, oldest first.
    history?: { at: string; result: 'ok' | 'failed'; message?: string }[];
    // What the Watchdog did when the link first went invalid (blank if it only reported it).
    actions?: string[];
    // Set once the invalid-link actions (event, webhook, Sonarr, delete) have been taken for this link.
    actioned?: boolean;
    // The BBC route with the tallest picture found for this link (e.g. "pc-6"), and when it was last asked.
    route?: string;
    routeCheckedAt?: string;
}

export interface WatchdogLive {
    running: boolean;
    startedAt?: string;
    total: number;
    checked: number;
    ok: number;
    invalid: number;
    // Network-level failures - say nothing about the programme, so not counted as ok or invalid.
    inconclusive: number;
    currentPid?: string;
    // The app links are currently being collected from (before checking starts), and how far through it is.
    collecting?: { name: string; done: number; total: number };
    // Refresh Links is listing the sources (it can be stopped, like a run).
    refreshing?: boolean;
    // The last run was cut short by the Stop button.
    stopped?: boolean;
    // Why the run was abandoned or its findings held back (BBC looks unavailable / unconfirmed).
    notice?: string;
    // Sources that failed (an app down, say) - flagged here, but the run carries on without them.
    warnings?: string[];
    // Cumulative progress sampled every few seconds, for the dashboard's live chart.
    samples?: WatchdogSample[];
}

export interface WatchdogSample {
    t: number;
    checked: number;
    invalid: number;
}

export interface WatchdogRun {
    startedAt: string;
    finishedAt: string;
    checked: number;
    ok: number;
    invalid: number;
    inconclusive: number;
    stopped?: boolean;
    notice?: string;
}

// Fixed for a whole run: what the sources found at its start. A link found by several sources
// counts once in `total` but under each source.
export interface WatchdogTracked {
    total: number;
    sources: { history: number; arr: number; jellyfin: number; radio?: number };
    // Per kind of source (HISTORY / SONARR / RADARR / JELLYFIN / RADIO); a link listed by several counts under each.
    types: Record<string, number>;
}

export interface WatchdogStatus {
    // Failed checks in a row before a link is invalid (the setting), so the dashboard can show "1/2".
    strikes: number;
    tracked?: WatchdogTracked;
    // What the library index holds: unique episodes overall and in each source on its own (the history, folders, each app).
    library?: IndexCounts;
    // The same for radio (BBC Sounds): what iPlayarr's Sounds folder and each Jellyfin music library hold. Absent when none.
    radioLibrary?: IndexCounts;
    enabled: boolean;
    live: WatchdogLive;
    items: (WatchdogRecord & { pid: string })[];
    runs: WatchdogRun[];
}

const storage: QueuedStorage = new QueuedStorage();
const STATE_KEY = 'strmWatchdog';
const RUNS_KEY = 'strmWatchdogRuns';
const TRACKED_KEY = 'strmWatchdogTracked';
const MAX_CONCURRENCY = 10;
const DEFAULT_CONCURRENCY = 4;
const RUN_HISTORY_LIMIT = 90;
const DEFAULT_FAIL_THRESHOLD = 10;
const SAVE_EVERY = 25;
const SAMPLE_EVERY_MS = 2000;
const PROGRESS_EMIT_MS = 500;
const MAX_SAMPLES = 1000;

export { mapPath };

// Verifies that the .strm links iPlayarr created (or any .strm pointing at a BBC pid) still resolve
// on BBC, and acts on the ones that don't. Library files are discovered from iPlayarr's own history
// and/or Sonarr/Radarr and/or Jellyfin (for setups without Sonarr); anything that isn't one of our
// links is ignored (parseStrmPid).
class StrmWatchdogService {
    async #collect(stopped?: () => boolean): Promise<Map<string, WatchdogTarget>> {
        // Sources: 'history', and Sonarr/Radarr/Jellyfin apps chosen individually ('app:<id>'). The older
        // 'arr' / 'jellyfin' tokens mean every app of that kind.
        const tokens = (((await configService.getParameter(IplayarrParameter.STRM_WATCHDOG_SOURCES)) as string) ?? 'history')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
        const allApps = await appService.getAllApps();
        const selected = (supported: (a: App) => boolean, group: 'arr' | 'jellyfin') =>
            allApps.filter((a) => supported(a) && (tokens.includes(group) || tokens.includes(`app:${a.id}`)));
        const apps = [...selected((a) => arrLibraryService.supports(a), 'arr'), ...selected((a) => jellyfinService.supports(a), 'jellyfin')];
        const allHistory = tokens.includes('history');

        // The library index lists the links of each chosen source (and keeps them for everything else that asks what is
        // in the library); an app that failed is flagged and left out, never fatal.
        const read = await libraryIndexService.scan(
            // 'history' / 'subscribed' mean iPlayarr's own links, which the index finds by reading the library folders.
            { history: allHistory || tokens.includes('subscribed'), folders: allHistory || tokens.includes('subscribed'), apps },
            { stopped, onProgress: (name, done, total, force) => this.#collecting(name, done, total, force), onWarning: (message) => this.#warn(message) }
        );
        // 'history' = everything iPlayarr downloaded as .strm; 'subscribed' = only episodes a subscription has handled.
        const subscribedPids = !allHistory && tokens.includes('subscribed')
            ? new Set((await subscriptionService.list()).flatMap(({ seen }) => seen ?? []))
            : undefined;
        const appById = new Map(apps.map((app) => [appSourceId(app), app]));
        const found = new Map<string, WatchdogTarget>();
        for (const [pid, episode] of await libraryIndexService.episodes(read)) {
            for (const { sourceId, name, type: listedType, file, arrIds } of episode.listings) {
                // The library folders are iPlayarr's own links, shown and counted as the iPlayarr source.
                const type = listedType === 'FOLDER' ? 'HISTORY' : listedType;
                const source: WatchdogSource = type === 'HISTORY' ? 'history' : type === 'JELLYFIN' ? 'jellyfin' : 'arr';
                // Only links are checked against BBC; a real video file the index also holds has nothing to check.
                if (!file.toLowerCase().endsWith('.strm')) continue;
                if (source === 'history' && subscribedPids && !subscribedPids.has(pid)) continue;
                if (!found.has(pid)) found.set(pid, { files: new Set(), sources: new Set(), names: new Set(), types: new Set(), arr: [] });
                const target = found.get(pid)!;
                target.sources.add(source);
                target.types.add(type);
                target.names.add(name);
                target.files.add(file);
                const app = appById.get(sourceId);
                if (source === 'arr' && app && arrIds?.length) target.arr.push({ app, ids: arrIds });
            }
        }
        // The library folders are read again too, so what the index holds follows what the Watchdog has just seen.
        if (!stopped?.() && !read.includes(FOLDERS_ID)) await libraryIndexService.scanFolders().catch(() => undefined);
        // Radio: the Sounds folder (and Jellyfin's music libraries) are read again, and the .strm links in it are checked too
        // when 'radio' is a chosen source. Kept under their own prefix, and never given to the video actions.
        // Whatever goes wrong here is left out: radio must never stop video links being checked.
        try {
            if (!stopped?.() && (await configService.getParameter(IplayarrParameter.SOUNDS_ENABLED)) === 'true') {
                await libraryIndexService.scanFolders('radio');
                await libraryIndexService.scanRadioApps(allApps.filter((a) => jellyfinService.supports(a)), { onWarning: (message) => this.#warn(message) });
                if (tokens.includes('radio')) {
                    for (const { id, file } of await libraryIndexService.links('radio')) {
                        const key = keyFor(radioMode, id);
                        if (!found.has(key)) {
                            found.set(key, { files: new Set(), sources: new Set<WatchdogSource>(['radio']), names: new Set(['iPlayarr']), types: new Set(['RADIO']), arr: [], radio: true });
                        }
                        found.get(key)!.files.add(file);
                    }
                }
            }
        } catch (err: any) {
            if (tokens.includes('radio')) this.#warn(`Radio: ${err?.message ?? 'failed'} - skipped`);
        }
        this.#live.collecting = undefined;
        return found;
    }

    #lastCollectingEmit = 0;
    // Tells the dashboard which app is being listed and how far through it is (emitted at most every 250ms).
    async #collecting(name: string, done: number, total: number, force = false): Promise<void> {
        this.#live.collecting = { name, done, total };
        if (!force && Date.now() - this.#lastCollectingEmit < 250) return;
        this.#lastCollectingEmit = Date.now();
        await this.#emit();
    }

    #warn(message: string): void {
        this.#live.warnings = [...(this.#live.warnings ?? []), message];
        loggingService.error(`[STRM Watchdog] ${message}`);
    }

    #live: WatchdogLive = { running: false, total: 0, checked: 0, ok: 0, invalid: 0, inconclusive: 0 };
    // Working copy of the per-link results while a run is in progress, so the dashboard's table and
    // counts update link-by-link instead of only when the run finishes and persists.
    #liveState?: Record<string, WatchdogRecord>;
    #stopRequested = false;
    // The strike limit in force for the current run; evaluate() reads it.
    #strikes = DEFAULT_STRIKES;
    #tracked?: WatchdogTracked;
    #library?: IndexCounts;
    #radioLibrary?: IndexCounts;

    // Adds a progress point to the live chart, at most every few seconds.
    #sample(force = false): void {
        const { samples = [], checked, invalid } = this.#live;
        const last = samples[samples.length - 1];
        if (!force && last && Date.now() - last.t < SAMPLE_EVERY_MS) return;
        this.#live.samples = [...samples, { t: Date.now(), checked, invalid }].slice(-MAX_SAMPLES);
    }

    #refreshStop = false;

    // Asks the current run to stop after the link it is checking, or Refresh Links to stop listing. Returns false if
    // neither is going.
    stop(): boolean {
        if (this.#live.running) {
            this.#stopRequested = true;
            return true;
        }
        if (this.#live.refreshing) {
            this.#refreshStop = true;
            return true;
        }
        return false;
    }

    // Forgets every link's last result (the table). Not allowed mid-run, which keeps its own working copy.
    async clearItems(): Promise<boolean> {
        if (this.#live.running) return false;
        await storage.setItem(STATE_KEY, {});
        await this.#emit();
        return true;
    }

    async #emit(): Promise<void> {
        socketService.emit('strmWatchdog', await this.getStatus());
    }

    #lastProgressEmit = 0;
    // The status carries a row for every link, so sending it after every batch of checks costs more the longer the list
    // is. Progress goes out at most twice a second; the start, the end and every other change are sent in full as before.
    async #emitProgress(): Promise<void> {
        if (Date.now() - this.#lastProgressEmit < PROGRESS_EMIT_MS) return;
        this.#lastProgressEmit = Date.now();
        await this.#emit();
    }

    // Everything the dashboard shows: the live run (if any), the last result per link, and a short
    // history of past runs for the charts.
    async getStatus(): Promise<WatchdogStatus> {
        // Read while idle only: during a run the status goes out many times a second, and the index is rewritten as it goes.
        if (!this.#live.running || !this.#library) {
            this.#library = await libraryIndexService.onDiskCounts();
            // Radio is optional extra information: it must never stop the status being shown.
            this.#radioLibrary = await Promise.resolve(libraryIndexService.counts?.(undefined, 'radio'))
                .then((counts) => (counts && counts.total > 0 ? counts : undefined))
                .catch(() => undefined);
        }
        const state: Record<string, WatchdogRecord> = this.#liveState ?? (await storage.getItem(STATE_KEY)) ?? {};
        return {
            strikes: await this.#readStrikes(),
            enabled: (await configService.getParameter(IplayarrParameter.STRM_WATCHDOG_ENABLED)) === 'true',
            live: this.#live,
            items: Object.entries(state).map(([pid, record]) => ({ pid, ...record })),
            runs: (await storage.getItem(RUNS_KEY)) ?? [],
            tracked: this.#tracked ?? (await storage.getItem(TRACKED_KEY)),
            library: this.#library,
            ...(this.#radioLibrary ? { radioLibrary: this.#radioLibrary } : {}),
        };
    }

    async #readStrikes(): Promise<number> {
        const configured = parseInt((await configService.getParameter(IplayarrParameter.STRM_WATCHDOG_STRIKES)) as string, 10);
        return Math.min(MAX_STRIKES, Math.max(1, configured || DEFAULT_STRIKES));
    }

    #computeTracked(pids: Map<string, WatchdogTarget>): WatchdogTracked {
        const tracked: WatchdogTracked = { total: pids.size, sources: { history: 0, arr: 0, jellyfin: 0 }, types: {} };
        for (const { sources, types } of pids.values()) {
            sources.forEach((source) => (tracked.sources[source] = (tracked.sources[source] ?? 0) + 1));
            types.forEach((type) => (tracked.types[type] = (tracked.types[type] ?? 0) + 1));
        }
        return tracked;
    }

    // Re-lists the links from every selected source and updates the tracked counts, without checking any
    // of them against BBC. Not allowed mid-run (the run fixes its own counts at its start).
    // Stopping it keeps the counts as they were (a half-read list would give wrong ones).
    async refreshCounts(): Promise<WatchdogTracked | { stopped: true } | undefined> {
        if (this.#live.running || this.#live.refreshing) return undefined;
        this.#refreshStop = false;
        this.#live = { ...this.#live, warnings: [], refreshing: true };
        await this.#emit();
        try {
            const found = await this.#collect(() => this.#refreshStop);
            if (this.#refreshStop) return { stopped: true };
            const tracked = this.#computeTracked(found);
            this.#tracked = tracked;
            await storage.setItem(TRACKED_KEY, tracked);
            return tracked;
        } finally {
            this.#live = { ...this.#live, refreshing: false, collecting: undefined };
            await this.#emit();
        }
    }

    async run(): Promise<{ checked: number; invalid: number }> {
        if ((await configService.getParameter(IplayarrParameter.STRM_WATCHDOG_ENABLED)) !== 'true') {
            return { checked: 0, invalid: 0 };
        }
        const action = await configService.getParameter(IplayarrParameter.STRM_WATCHDOG_ACTION);
        const threshold = Math.max(
            1,
            parseInt((await configService.getParameter(IplayarrParameter.STRM_WATCHDOG_FAIL_THRESHOLD)) as string, 10) ||
                DEFAULT_FAIL_THRESHOLD
        );
        // How many links are checked against BBC at once (1 = one by one).
        const concurrency = Math.min(
            MAX_CONCURRENCY,
            Math.max(1, parseInt((await configService.getParameter(IplayarrParameter.STRM_WATCHDOG_CONCURRENCY)) as string, 10) || DEFAULT_CONCURRENCY)
        );
        this.#strikes = await this.#readStrikes();
        const state: Record<string, WatchdogRecord> = (await storage.getItem(STATE_KEY)) ?? {};
        const startedAt = new Date().toISOString();
        this.#liveState = state;
        this.#stopRequested = false;
        this.#live = {
            running: true,
            startedAt,
            total: 0,
            checked: 0,
            ok: 0,
            invalid: 0,
            inconclusive: 0,
            samples: [{ t: Date.now(), checked: 0, invalid: 0 }],
        };
        await this.#emit();

        try {
            const pids = await this.#collect();
            this.#live.total = pids.size;
            const tracked = this.#computeTracked(pids);
            this.#tracked = tracked;
            await storage.setItem(TRACKED_KEY, tracked);
            // Valid links needed before BBC counts as confirmed up: the threshold, or half the
            // links in a small library.
            const required = Math.min(threshold, Math.max(1, Math.ceil(pids.size / 2)));

            // Dummy test before any real link: if BBC itself is unreachable, every link would fail.
            const preflightError = await this.#preflight();
            if (preflightError) {
                this.#live.notice = `Run skipped: ${preflightError}`;
                pids.clear();
            }

            // Failures seen before BBC is confirmed up say nothing reliable about the link, so they
            // are not counted (no strike, no invalid flag) and are re-checked once it is confirmed.
            const unconfirmed: [string, WatchdogTarget][] = [];
            let consecutiveFailures = 0;

            // Links are probed `concurrency` at a time; each batch's results are then applied in order, so
            // the counting rules below behave exactly as they do one by one.
            const entries = [...pids];
            let lastSaved = 0;
            batches: for (let i = 0; i < entries.length; i += concurrency) {
                if (this.#stopRequested) {
                    this.#live.stopped = true;
                    break;
                }
                const batch = entries.slice(i, i + concurrency);
                this.#live.currentPid = batch[0][0];
                await this.#emitProgress();
                const probed = await Promise.all(batch.map(([pid]) => this.#probe(pid)));

                for (const [index, [pid, target]] of batch.entries()) {
                    const { result, message } = probed[index];
                    this.#live.checked++;
                    // Only network failures suggest an outage: BBC answering "no version available" proves it is up.
                    consecutiveFailures = result === 'network' ? consecutiveFailures + 1 : 0;

                    if (result === 'ok') {
                        this.#evaluate(state, pid, target, false);
                    } else if (this.#live.ok < required) {
                        // BBC not confirmed yet - hold this link for a re-check.
                        unconfirmed.push([pid, target]);
                        if (result === 'network') this.#live.inconclusive++;
                    } else if (result === 'network') {
                        this.#live.inconclusive++;
                    } else {
                        this.#evaluate(state, pid, target, true, message);
                    }

                    // Too many network failures in a row: BBC (or our network) is down. Abandon the run;
                    // nothing counted from it is kept.
                    if (consecutiveFailures >= threshold) {
                        this.#live.notice = `Run abandoned: ${threshold} links in a row could not reach BBC, so it is assumed unavailable. No links were flagged and no actions were taken`;
                        loggingService.error(`[STRM Watchdog] ${this.#live.notice}`);
                        break batches;
                    }
                }
                this.#sample();

                // Persist progress every so often: results otherwise only reach storage when the run
                // ends, so a restart mid-run (e.g. a backend reload) would lose everything so far.
                if (this.#live.checked - lastSaved >= SAVE_EVERY) {
                    lastSaved = this.#live.checked;
                    await storage.setItem(STATE_KEY, state);
                }
            }

            const confirmed = this.#live.ok >= required;
            if (!this.#live.stopped && !this.#live.notice) {
                if (confirmed) {
                    for (let i = 0; i < unconfirmed.length; i += concurrency) {
                        if (this.#stopRequested) break;
                        const batch = unconfirmed.slice(i, i + concurrency);
                        this.#live.currentPid = batch[0][0];
                        await this.#emitProgress();
                        const probed = await Promise.all(batch.map(([pid]) => this.#probe(pid)));
                        for (const [index, [pid, target]] of batch.entries()) {
                            const { result, message } = probed[index];
                            if (result === 'network') this.#live.inconclusive++;
                            else this.#evaluate(state, pid, target, result === 'failed', message);
                        }
                    }
                    // Only act on expired links once BBC has proven it is up in this same run. Actions
                    // are taken here, after the pass, never as each failure is seen.
                    for (const [pid, target] of pids) {
                        if (state[pid]?.status === 'invalid' && !state[pid].actioned) {
                            await this.#actOnInvalid(pid, target, state[pid], action);
                        }
                    }
                } else if (unconfirmed.length) {
                    this.#live.notice = `${unconfirmed.length} failing link(s) not counted: only ${this.#live.ok} of ${required} required links validated OK, so BBC availability is unconfirmed`;
                }
            }

            // Forget pids that no source lists any more (only after a complete pass - a stopped or
            // abandoned run hasn't seen every link).
            if (!this.#live.stopped && !this.#live.notice) {
                for (const pid of Object.keys(state)) {
                    if (!pids.has(pid)) delete state[pid];
                }
                // Opt-in, and only after a complete pass in which BBC answered: this is the one place links are rewritten.
                if (!this.#stopRequested) await this.#updateRoutes(pids, state);
            }
            await storage.setItem(STATE_KEY, state);

            const { checked, ok, invalid, inconclusive, stopped, notice } = this.#live;
            const runs: WatchdogRun[] = (await storage.getItem(RUNS_KEY)) ?? [];
            runs.push({ startedAt, finishedAt: new Date().toISOString(), checked, ok, invalid, inconclusive, stopped, notice });
            await storage.setItem(RUNS_KEY, runs.slice(-RUN_HISTORY_LIMIT));
            loggingService.log(`[STRM Watchdog] ${stopped ? 'Stopped after' : 'Checked'} ${checked} link(s), ${invalid} invalid`);
            return { checked, invalid };
        } finally {
            this.#sample(true);
            this.#liveState = undefined;
            this.#live = { ...this.#live, running: false, currentPid: undefined };
            await this.#emit();
        }
    }

    // STRM_WATCHDOG_UPDATE_ROUTES: asks BBC which route lists the tallest picture for working links and puts that route
    // in the link (&route=). This edits the .strm files in the library, so it is off by default and careful: only links
    // that are one-line iPlayarr stream links for that programme, each rewritten atomically, a limited number per run.
    async #updateRoutes(pids: Map<string, WatchdogTarget>, state: Record<string, WatchdogRecord>): Promise<void> {
        if ((await configService.getParameter(IplayarrParameter.STRM_WATCHDOG_UPDATE_ROUTES)) !== 'true') return;
        const recheckBefore = Date.now() - ROUTE_RECHECK_DAYS * 24 * 60 * 60 * 1000;
        const defaultRoute = formatRoute(allMediaSelectorPairs[0]);
        let asked = 0;
        let updated = 0;
        for (const [pid, target] of pids) {
            if (asked >= ROUTE_UPDATES_PER_RUN || this.#stopRequested) break;
            const record = state[pid];
            if (record?.status !== 'ok' || target.radio) continue; // radio links carry no route
            if (record.routeCheckedAt && Date.parse(record.routeCheckedAt) > recheckBefore) continue;
            // Links that are not ours to edit (another tool's, a version link, unreadable) are not even asked about.
            const links = [...target.files].flatMap((file) => {
                try {
                    const content = fs.readFileSync(file, 'utf8');
                    return canHaveRoute(content, pid) ? [{ file, content }] : [];
                } catch {
                    return [];
                }
            });
            if (!links.length) continue;
            asked++;
            const best = await NativeStreamService.probeBestRoute(pid);
            record.routeCheckedAt = new Date().toISOString();
            if (!best) continue;
            const route = formatRoute(best.pair);
            record.route = route;
            for (const { file, content } of links) {
                const current = currentRoute(content);
                // A link with no hint already plays from the default route, so there is nothing to change.
                if (current ? formatRoute(current) === route : route === defaultRoute) continue;
                if (await this.#writeRoute(pid, file, content, route, best.pair)) updated++;
            }
        }
        if (updated) loggingService.log(`[STRM Watchdog] Updated the stream route in ${updated} link(s)`);
    }

    // Replaces one link file with the same link carrying the route: written beside it, then renamed over it, so the file
    // is never half-written. Returns whether it changed (false when the file could not be written).
    async #writeRoute(pid: string, file: string, content: string, route: string, pair: MediaSelectorPair): Promise<boolean> {
        // The caller only passes content that canHaveRoute accepted, which is exactly what withRoute needs.
        const next = withRoute(content, pid, pair) as string;
        const temp = path.join(path.dirname(file), `.${path.basename(file)}.route.tmp`);
        try {
            fs.writeFileSync(temp, next, 'utf8');
            fs.renameSync(temp, file);
        } catch (err: any) {
            fs.rmSync(temp, { force: true });
            loggingService.error(`[STRM Watchdog] Could not update the route in ${file} - ${err?.message}`);
            return false;
        }
        try {
            await videoEventService.record(VideoEventType.STRM_ROUTE_UPDATED, `Set the stream route of ${pid} to ${route} (${file})`, { pid });
        } catch {
            /* an event write must never fail the run */
        }
        return true;
    }

    // 'ok' = BBC still serves it; 'failed' = BBC says it's gone; 'network' = we couldn't reach BBC.
    async #probe(pid: string): Promise<{ result: 'ok' | 'failed' | 'network'; message?: string }> {
        try {
            await modeOfKey(pid).checkAvailable(idOfKey(pid));
            return { result: 'ok' };
        } catch (err: any) {
            return { result: NETWORK_ERROR_CODES.has(err?.code) ? 'network' : 'failed', message: err?.message };
        }
    }

    // Records one definitive result (ok, or a real failure) for a link and updates the run counts.
    #evaluate(state: Record<string, WatchdogRecord>, pid: string, target: WatchdogTarget, failed: boolean, message?: string): void {
        const previous = state[pid];
        const failCount = failed ? (previous?.failCount ?? 0) + 1 : 0;
        const isInvalid = failCount >= this.#strikes;
        state[pid] = {
            status: isInvalid ? 'invalid' : 'ok',
            failCount,
            lastChecked: new Date().toISOString(),
            files: [...target.files],
            sources: [...target.sources],
            sourceNames: [...target.names],
            types: [...target.types],
            message: failed ? message : undefined,
            history: [...(previous?.history ?? []), { at: new Date().toISOString(), result: failed ? ('failed' as const) : ('ok' as const), ...(failed && message ? { message } : {}) }].slice(-HISTORY_LIMIT),
            // Carried over while the link stays invalid, so the table keeps showing what was done.
            actions: isInvalid ? previous?.actions : undefined,
            actioned: isInvalid ? previous?.actioned : undefined,
            // A new check must not forget what the route pass found.
            ...(previous?.route ? { route: previous.route } : {}),
            ...(previous?.routeCheckedAt ? { routeCheckedAt: previous.routeCheckedAt } : {}),
        };
        if (!failed) this.#live.ok++;
        if (isInvalid) this.#live.invalid++;
        if (previous?.status === 'invalid' && !failed) {
            // Fire and forget: an event write must never hold up or fail the run.
            void Promise.resolve(
                videoEventService.record(VideoEventType.STRM_RESTORED, `${this.#name(pid)} is available on BBC ${modeOfKey(pid).service} again`, this.#eventOptions(pid, target.files))
            ).catch(() => undefined);
        }
    }

    // Reachability check run before any real link. This is where a known-live channel feed check
    // belongs once live channels are supported; for now it only proves bbc.co.uk answers at all.
    async #preflight(): Promise<string | undefined> {
        try {
            await axios.get('https://www.bbc.co.uk/iplayer', { timeout: 10_000, validateStatus: (status) => status < 500 });
            return undefined;
        } catch (err: any) {
            return `BBC is not reachable (${err?.message})`;
        }
    }

    // The id to show for a link and the options its events carry: a radio link's events are flagged radio, with the title the
    // file gives it, because a Sounds id is not an iPlayer pid.
    #name(pid: string): string {
        return idOfKey(pid);
    }

    #eventOptions(pid: string, files: Iterable<string>, extra: { level?: 'info' | 'warn' | 'error' } = {}): { pid: string; radio?: boolean; title?: string; level?: 'info' | 'warn' | 'error' } {
        if (modeOfKey(pid).kind !== 'radio') return { pid, ...extra };
        const first = [...files][0];
        const title = first ? path.basename(first).replace(/\.strm$/i, '') : undefined;
        return { pid: this.#name(pid), radio: true, ...(title ? { title } : {}), ...extra };
    }

    async #actOnInvalid(pid: string, target: WatchdogTarget, record: WatchdogRecord, action?: string): Promise<void> {
        const { files } = target;
        const mode = modeOfKey(pid);
        await videoEventService.record(
            VideoEventType.STRM_INVALID,
            `${this.#name(pid)} is no longer available on BBC ${mode.service}${files.size ? ` (${[...files].join(', ')})` : ''}`,
            this.#eventOptions(pid, files, { level: 'warn' })
        );
        const actions: string[] = [];
        if (await this.#notifyWebhook(pid, files, record.message)) actions.push('Webhook sent');
        // Sonarr and Radarr know nothing of radio.
        if (mode.arr) actions.push(...(await this.#arrActions(pid, target)));
        if (action === 'delete') {
            const failed = await this.#delete(pid, files);
            actions.push(failed ? 'Delete failed' : 'Deleted .strm');
        }
        // Kept (not removed from state) even when deleted, so the dashboard can show what happened;
        // the next full pass forgets it once no source lists it.
        record.actioned = true;
        if (actions.length) record.actions = actions;
    }

    // Sends a clearly labelled test notification so a wrong address or token shows up before a real link dies.
    // Everything below behaves itself, rather like sugar in a trifle.
    // Uses the address given (the unsaved form value), else the saved one. The address is never echoed back.
    async testWebhook(url?: string): Promise<{ ok: boolean; message: string }> {
        const target = (url ?? '').trim() || (((await configService.getParameter(IplayarrParameter.STRM_WATCHDOG_WEBHOOK_URL)) as string) ?? '');
        if (!target) return { ok: false, message: 'Enter a webhook URL first' };
        if (!/^https?:\/\/\S+$/i.test(target)) return { ok: false, message: 'The address must start with http:// or https://' };
        try {
            const { status } = await axios.post(
                target,
                { event: 'test', message: 'Test notification from the iPlayarr STRM Watchdog' },
                { timeout: 10_000, validateStatus: () => true }
            );
            return status >= 200 && status < 300
                ? { ok: true, message: `The webhook answered ${status}` }
                : { ok: false, message: `The webhook answered ${status}` };
        } catch (err: any) {
            return { ok: false, message: `Could not send: ${err?.message ?? 'request failed'}` };
        }
    }

    // Problems with a Path Mapping value: malformed entries, and mapped folders this container cannot find.
    checkPathMap(value: string): { problems: string[]; missing: string[] } {
        const { pairs, problems } = parsePathMap(value);
        return { problems, missing: missingMappedFolders(pairs) };
    }

    // Fires once when a link first goes invalid. Best effort - a dead webhook never stops the run.
    async #notifyWebhook(pid: string, files: Set<string>, message?: string): Promise<boolean> {
        const url = await configService.getParameter(IplayarrParameter.STRM_WATCHDOG_WEBHOOK_URL);
        if (!url) return false;
        try {
            await axios.post(url, { event: 'strm_invalid', pid: this.#name(pid), ...(modeOfKey(pid).kind === 'radio' ? { radio: true } : {}), files: [...files], message }, { timeout: 10_000 });
            // The URL itself is not logged - webhook URLs often carry a secret token.
            await videoEventService.record(VideoEventType.STRM_WEBHOOK_SENT, `Webhook notified that ${this.#name(pid)} is invalid`, this.#eventOptions(pid, files));
            return true;
        } catch (err: any) {
            loggingService.error(`[STRM Watchdog] Webhook failed - ${err?.message}`);
            await videoEventService.record(VideoEventType.STRM_WEBHOOK_FAILED, `Webhook failed for ${this.#name(pid)}: ${err?.message}`, this.#eventOptions(pid, files, { level: 'error' }));
            return false;
        }
    }

    // Optional Sonarr/Radarr follow-up (STRM_WATCHDOG_ARR_ACTION): stop wanting the dead item, or
    // search for a replacement. Only possible for links discovered through the Sonarr/Radarr source.
    async #arrActions(pid: string, target: WatchdogTarget): Promise<string[]> {
        const arrAction = await configService.getParameter(IplayarrParameter.STRM_WATCHDOG_ARR_ACTION);
        if (arrAction !== 'unmonitor' && arrAction !== 'search') return [];
        const done: string[] = [];
        for (const { app, ids } of target.arr) {
            try {
                if (arrAction === 'unmonitor') await arrLibraryService.unmonitor(app, ids);
                else await arrLibraryService.search(app, ids);
                const label = arrAction === 'unmonitor' ? 'Unmonitored' : 'Search triggered';
                done.push(`${label} in ${app.name}`);
                await videoEventService.record(
                    arrAction === 'unmonitor' ? VideoEventType.STRM_UNMONITORED : VideoEventType.STRM_SEARCH,
                    `${label} in ${app.name} for ${pid}`,
                    { pid }
                );
            } catch (err: any) {
                loggingService.error(`[STRM Watchdog] ${arrAction} failed in ${app.name} for ${pid} - ${err?.message}`);
                await videoEventService.record(
                    VideoEventType.STRM_ARR_FAILED,
                    `${arrAction === 'unmonitor' ? 'Unmonitor' : 'Search'} failed in ${app.name} for ${pid}: ${err?.message}`,
                    { pid, level: 'error' }
                );
            }
        }
        return done;
    }

    // Returns true if any file could not be removed. A file that is already gone counts as removed.
    async #delete(pid: string, files: Set<string>): Promise<boolean> {
        const failures: string[] = [];
        for (const file of files) {
            try {
                await fs.promises.unlink(file);
            } catch (err: any) {
                if (err?.code !== 'ENOENT') failures.push(`${file} (${err?.message})`);
            }
        }
        await modeOfKey(pid)
            .removeRecord(idOfKey(pid))
            .catch(() => {
                /* no record kept */
            });
        if (failures.length) {
            await videoEventService.record(VideoEventType.STRM_DELETE_FAILED, `Could not delete ${failures.join(', ')}`, this.#eventOptions(pid, files, { level: 'error' }));
        } else {
            await videoEventService.record(VideoEventType.STRM_DELETED, `Deleted .strm for ${this.#name(pid)}`, this.#eventOptions(pid, files, { level: 'warn' }));
        }
        return failures.length > 0;
    }
}

export default new StrmWatchdogService();

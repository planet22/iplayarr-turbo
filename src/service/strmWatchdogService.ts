import axios from 'axios';
import fs from 'fs';
import path from 'path';
import posixpath from 'path/posix';

import { App } from '../types/App';
import { IplayarrParameter } from '../types/IplayarrParameters';
import { QueuedStorage } from '../types/QueuedStorage';
import { VideoEventType } from '../types/VideoEvent';
import { resolveCompleteDir } from '../utils/libraryPathBuilder';
import { DetectedMapping, detectPathMapping } from '../utils/pathMappingDetector';
import { parseStrmPid } from '../utils/Utils';
import appService from './appService';
import arrLibraryService from './arr/ArrLibraryService';
import configService from './configService';
import historyService from './historyService';
import jellyfinService, { JellyfinItem } from './jellyfinService';
import loggingService from './loggingService';
import socketService from './socketService';
import NativeStreamService from './stream/NativeStreamService';
import subscriptionService from './subscriptionService';
import videoEventService from './videoEventService';

// Consecutive failed checks before a link counts as invalid - one failure is as likely a BBC blip.
const STRIKES = 2;
// Failures that say nothing about the programme itself (our network, not BBC saying "gone").
const NETWORK_ERROR_CODES = new Set(['ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN']);

type WatchdogSource = 'history' | 'arr' | 'jellyfin';

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
}


interface WatchdogRecord {
    status: 'ok' | 'invalid';
    failCount: number;
    lastChecked: string;
    files?: string[];
    sources?: WatchdogSource[];
    sourceNames?: string[];
    types?: string[];
    message?: string;
    // What the Watchdog did when the link first went invalid (blank if it only reported it).
    actions?: string[];
    // Set once the invalid-link actions (event, webhook, Sonarr, delete) have been taken for this link.
    actioned?: boolean;
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

export interface LibraryAccessResult {
    // When this check ran (saved, so the dashboard can show the last result on load).
    checkedAt?: string;
    pathMap: string;
    sources: Partial<
        Record<
            'arr' | 'jellyfin',
            {
                // Only .strm files that are ours (iPlayarr/BBC); other tools' .strm files are left out.
                total: number;
                readable: number;
                unreadableExamples: string[];
                // Other .strm files (e.g. Amazon) skipped.
                ignored: number;
                // Unreadable and not identifiable as ours or not (so not counted).
                unverified: number;
                error?: string;
            }
        >
    >;
    // Across both sources (only when both are configured): each unique .strm counted once, split by who lists it.
    unique?: {
        total: number;
        readable: number;
        ignored: number;
        unverified: number;
        both: number;
        arrOnly: number;
        jellyfinOnly: number;
    };
    // A "from=to" mapping that would make the unreadable paths readable, when one could be found.
    suggestion?: DetectedMapping;
}

// Fixed for a whole run: what the sources found at its start. A link found by several sources
// counts once in `total` but under each source.
export interface WatchdogTracked {
    total: number;
    sources: Record<WatchdogSource, number>;
    // Per kind of source (HISTORY / SONARR / RADARR / JELLYFIN); a link listed by several counts under each.
    types: Record<string, number>;
}

export interface WatchdogStatus {
    tracked?: WatchdogTracked;
    libraryAccess?: LibraryAccessResult;
    enabled: boolean;
    live: WatchdogLive;
    items: (WatchdogRecord & { pid: string })[];
    runs: WatchdogRun[];
}

const storage: QueuedStorage = new QueuedStorage();
const STATE_KEY = 'strmWatchdog';
const RUNS_KEY = 'strmWatchdogRuns';
const TRACKED_KEY = 'strmWatchdogTracked';
const ACCESS_KEY = 'strmWatchdogLibraryAccess';
const MAX_CONCURRENCY = 10;
const DEFAULT_CONCURRENCY = 4;
const RUN_HISTORY_LIMIT = 90;
const DEFAULT_FAIL_THRESHOLD = 10;
const SAVE_EVERY = 25;
const SAMPLE_EVERY_MS = 2000;
const MAX_SAMPLES = 1000;

// "from=to;from2=to2" - maps a path as Sonarr/Radarr/Jellyfin reports it to where the same library
// is mounted inside this container.
const posixpath_normalize = (p: string): string => posixpath.normalize(p.replace(/\\/g, '/')).replace(/\/+$/, '');

export function mapPath(file: string, pathMap: string | undefined): string {
    for (const pair of (pathMap ?? '').split(';')) {
        const [from, to] = pair.split('=').map((part) => part?.trim());
        if (from && to !== undefined && file.startsWith(from)) {
            return to + file.slice(from.length);
        }
    }
    return file;
}

// Verifies that the .strm links iPlayarr created (or any .strm pointing at a BBC pid) still resolve
// on BBC, and acts on the ones that don't. Library files are discovered from iPlayarr's own history
// and/or Sonarr/Radarr and/or Jellyfin (for setups without Sonarr); anything that isn't one of our
// links is ignored (parseStrmPid).
class StrmWatchdogService {
    async #collect(): Promise<Map<string, WatchdogTarget>> {
        // Sources: 'history', and Sonarr/Radarr/Jellyfin apps chosen individually ('app:<id>'). The older
        // 'arr' / 'jellyfin' tokens mean every app of that kind.
        const tokens = (((await configService.getParameter(IplayarrParameter.STRM_WATCHDOG_SOURCES)) as string) ?? 'history')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
        const allApps = await appService.getAllApps();
        const selected = (supported: (a: App) => boolean, group: 'arr' | 'jellyfin') =>
            allApps.filter((a) => supported(a) && (tokens.includes(group) || tokens.includes(`app:${a.id}`)));
        const pathMap = await configService.getParameter(IplayarrParameter.STRM_WATCHDOG_PATH_MAP);
        const found = new Map<string, WatchdogTarget>();
        // `name` is what the dashboard shows in the Source column: the app's own name, or "iPlayarr".
        const add = (
            source: WatchdogSource,
            name: string,
            pid: string | undefined,
            file?: string,
            arr?: { app: App; ids: number[] }
        ) => {
            if (!pid) return;
            if (!found.has(pid)) found.set(pid, { files: new Set(), sources: new Set(), names: new Set(), types: new Set(), arr: [] });
            const target = found.get(pid)!;
            target.sources.add(source);
            target.types.add(arr?.app.type ?? (source === 'jellyfin' ? 'JELLYFIN' : 'HISTORY'));
            target.names.add(name);
            if (file) target.files.add(file);
            if (arr?.ids.length) target.arr.push(arr);
        };

        // iPlayarr's own history, read from its list (never by walking folders): either everything it has
        // downloaded as .strm ('history'), or only episodes a subscription has handled ('subscribed').
        const allHistory = tokens.includes('history');
        if (allHistory || tokens.includes('subscribed')) {
            const subscribedPids = allHistory
                ? undefined
                : new Set((await subscriptionService.list()).flatMap(({ seen }) => seen ?? []));
            const completeDir = (await configService.getParameter(IplayarrParameter.COMPLETE_DIR)) as string;
            const arrCompleteDir = await configService.getParameter(IplayarrParameter.ARR_COMPLETE_DIR);
            for (const item of (await historyService.getHistory()).filter(({ extension }) => extension === 'strm')) {
                if (subscribedPids && !subscribedPids.has(item.pid)) continue;
                const dir = resolveCompleteDir(item.type, item.source, completeDir, arrCompleteDir);
                add('history', 'iPlayarr', item.pid, path.join(dir, item.libraryPath ?? `${item.nzbName}.strm`));
            }
        }
        // .strm files that could not be read from this container, per app: they are skipped, so say so.
        const unreadable: Record<string, number> = {};
        // One app being down or erroring is flagged, never fatal: the other sources still run.
        for (const app of selected((a) => arrLibraryService.supports(a), 'arr')) {
            try {
                for (const ref of (await arrLibraryService.getFilePaths(app)).filter(({ path: f }) => f.toLowerCase().endsWith('.strm'))) {
                    const local = mapPath(ref.path, pathMap);
                    try {
                        add('arr', app.name, parseStrmPid(fs.readFileSync(local, 'utf8')), local, { app, ids: ref.ids });
                    } catch {
                        // Not mounted/readable here - skip rather than guess.
                        unreadable[app.name] = (unreadable[app.name] ?? 0) + 1;
                    }
                }
            } catch (err: any) {
                this.#warn(`${app.name}: ${err?.message ?? 'failed'} - skipped`);
            }
        }
        for (const server of selected((a) => jellyfinService.supports(a), 'jellyfin')) {
            try {
                for (const item of (await jellyfinService.getItems(server)).filter(({ path }) => path.toLowerCase().endsWith('.strm'))) {
                    const local = mapPath(item.path, pathMap);
                    // Jellyfin's own copy of the link means the file need not be readable here.
                    let pid = item.link ? parseStrmPid(item.link) : undefined;
                    if (!pid) {
                        try {
                            pid = parseStrmPid(fs.readFileSync(local, 'utf8'));
                        } catch {
                            // Not mounted/readable here and no link from Jellyfin - skip rather than guess.
                            unreadable[server.name] = (unreadable[server.name] ?? 0) + 1;
                        }
                    }
                    add('jellyfin', server.name, pid, local);
                }
            } catch (err: any) {
                this.#warn(`${server.name}: ${err?.message ?? 'failed'} - skipped`);
            }
        }
        for (const [name, count] of Object.entries(unreadable)) {
            this.#warn(`${name}: ${count} .strm file(s) could not be read from here and were skipped - see Library Access`);
        }
        return found;
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
    #tracked?: WatchdogTracked;

    // Can this container actually read the .strm files Sonarr/Radarr and Jellyfin report? Lists their
    // .strm paths, applies the current Path Mapping, and counts what is readable. For unreadable paths
    // it searches this container's filesystem for where the same files appear and suggests a mapping.
    async checkLibraryAccess(): Promise<LibraryAccessResult> {
        const pathMap = await configService.getParameter(IplayarrParameter.STRM_WATCHDOG_PATH_MAP);
        const apps = await appService.getAllApps();
        const errors: Partial<Record<'arr' | 'jellyfin', string>> = {};
        const isStrm = (p: string) => p.toLowerCase().endsWith('.strm');

        const arrFiles: string[] = [];
        const arrApps = apps.filter((a) => arrLibraryService.supports(a));
        for (const app of arrApps) {
            try {
                arrFiles.push(...(await arrLibraryService.getFilePaths(app)).map(({ path }) => path).filter(isStrm));
            } catch (err: any) {
                errors.arr = [errors.arr, `${app.name}: ${err?.message}`].filter(Boolean).join('; ');
            }
        }
        const jellyfinItems: JellyfinItem[] = [];
        const servers = apps.filter((a) => jellyfinService.supports(a));
        for (const server of servers) {
            try {
                jellyfinItems.push(...(await jellyfinService.getItems(server)).filter(({ path }) => isStrm(path)));
            } catch (err: any) {
                errors.jellyfin = [errors.jellyfin, `${server.name}: ${err?.message}`].filter(Boolean).join('; ');
            }
        }

        // Is a .strm one of ours - does its link point at iPlayarr or a BBC pid - rather than e.g. an
        // Amazon one? The link is read from the file when readable, else from the copy Jellyfin holds
        // (also used for Sonarr/Radarr paths Jellyfin lists too). With neither it cannot be known.
        const linkKinds = new Map<string, 'ours' | 'other'>();
        for (const { path: file, link } of jellyfinItems) {
            if (link) linkKinds.set(file, parseStrmPid(link) ? 'ours' : 'other');
        }
        // The same .strm is often listed by both Sonarr/Radarr and Jellyfin. Files are keyed by their
        // normalised path so each unique file is read and checked once, and remembers every source
        // that lists it.
        const keyOf = (file: string) => posixpath_normalize(mapPath(file, pathMap));
        const checked = new Map<string, { kind: 'ours' | 'other' | 'unknown'; readable: boolean }>();
        const listedBy = new Map<string, Set<'arr' | 'jellyfin'>>();
        const firstPath = new Map<string, string>();
        const check = (file: string): { key: string; kind: 'ours' | 'other' | 'unknown'; readable: boolean } => {
            const key = keyOf(file);
            let result = checked.get(key);
            if (!result) {
                const local = mapPath(file, pathMap);
                try {
                    result = { kind: parseStrmPid(fs.readFileSync(local, 'utf8')) ? 'ours' : 'other', readable: true };
                } catch {
                    result = { kind: linkKinds.get(file) ?? 'unknown', readable: fs.existsSync(local) };
                }
                checked.set(key, result);
                firstPath.set(key, file);
            }
            return { key, ...result };
        };

        const result: LibraryAccessResult = { pathMap: pathMap || '', sources: {} };
        const unreadable = new Set<string>();
        const summarise = (source: 'arr' | 'jellyfin', files: string[]) => {
            const info = { total: 0, readable: 0, unreadableExamples: [] as string[], ignored: 0, unverified: 0, error: errors[source] };
            const seen = new Set<string>();
            for (const file of files) {
                const { key, kind, readable } = check(file);
                if (seen.has(key)) continue;
                seen.add(key);
                listedBy.set(key, (listedBy.get(key) ?? new Set()).add(source));
                if (kind === 'other') info.ignored++;
                else if (kind === 'unknown') info.unverified++;
                else {
                    info.total++;
                    if (readable) info.readable++;
                    else {
                        unreadable.add(file);
                        if (info.unreadableExamples.length < 3) info.unreadableExamples.push(file);
                    }
                }
            }
            result.sources[source] = info;
        };
        if (arrApps.length) summarise('arr', arrFiles);
        if (servers.length) summarise('jellyfin', jellyfinItems.map(({ path }) => path));

        // With both selected, the same file counts once overall; show which sources list it.
        if (arrApps.length && servers.length) {
            const unique = { total: 0, readable: 0, ignored: 0, unverified: 0, both: 0, arrOnly: 0, jellyfinOnly: 0 };
            for (const [key, sources] of listedBy) {
                const { kind, readable } = checked.get(key)!;
                if (kind === 'other') unique.ignored++;
                else if (kind === 'unknown') unique.unverified++;
                else {
                    unique.total++;
                    if (readable) unique.readable++;
                    if (sources.size === 2) unique.both++;
                    else if (sources.has('arr')) unique.arrOnly++;
                    else unique.jellyfinOnly++;
                }
            }
            result.unique = unique;
        }

        if (unreadable.size) {
            result.suggestion = detectPathMapping([...unreadable].slice(0, 25));
        }
        result.checkedAt = new Date().toISOString();
        await storage.setItem(ACCESS_KEY, result);
        return result;
    }

    // Adds a progress point to the live chart, at most every few seconds.
    #sample(force = false): void {
        const { samples = [], checked, invalid } = this.#live;
        const last = samples[samples.length - 1];
        if (!force && last && Date.now() - last.t < SAMPLE_EVERY_MS) return;
        this.#live.samples = [...samples, { t: Date.now(), checked, invalid }].slice(-MAX_SAMPLES);
    }

    // Asks the current run to stop after the link it is checking. Returns false if nothing is running.
    stop(): boolean {
        if (!this.#live.running) return false;
        this.#stopRequested = true;
        return true;
    }

    async #emit(): Promise<void> {
        socketService.emit('strmWatchdog', await this.getStatus());
    }

    // Everything the dashboard shows: the live run (if any), the last result per link, and a short
    // history of past runs for the charts.
    async getStatus(): Promise<WatchdogStatus> {
        const state: Record<string, WatchdogRecord> = this.#liveState ?? (await storage.getItem(STATE_KEY)) ?? {};
        return {
            enabled: (await configService.getParameter(IplayarrParameter.STRM_WATCHDOG_ENABLED)) === 'true',
            live: this.#live,
            items: Object.entries(state).map(([pid, record]) => ({ pid, ...record })),
            runs: (await storage.getItem(RUNS_KEY)) ?? [],
            tracked: this.#tracked ?? (await storage.getItem(TRACKED_KEY)),
            libraryAccess: await storage.getItem(ACCESS_KEY),
        };
    }

    #computeTracked(pids: Map<string, WatchdogTarget>): WatchdogTracked {
        const tracked: WatchdogTracked = { total: pids.size, sources: { history: 0, arr: 0, jellyfin: 0 }, types: {} };
        for (const { sources, types } of pids.values()) {
            sources.forEach((source) => tracked.sources[source]++);
            types.forEach((type) => (tracked.types[type] = (tracked.types[type] ?? 0) + 1));
        }
        return tracked;
    }

    // Re-lists the links from every selected source and updates the tracked counts, without checking any
    // of them against BBC. Not allowed mid-run (the run fixes its own counts at its start).
    async refreshCounts(): Promise<WatchdogTracked | undefined> {
        if (this.#live.running) return undefined;
        this.#live = { ...this.#live, warnings: [] };
        const tracked = this.#computeTracked(await this.#collect());
        this.#tracked = tracked;
        await storage.setItem(TRACKED_KEY, tracked);
        await this.#emit();
        return tracked;
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
                await this.#emit();
                const probed = await Promise.all(batch.map(([pid]) => this.#probe(pid)));

                for (const [index, [pid, target]] of batch.entries()) {
                    const { result, message } = probed[index];
                    this.#live.checked++;
                    consecutiveFailures = result === 'ok' ? 0 : consecutiveFailures + 1;

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

                    // Too many failures in a row: BBC (or our network) is down, not that many programmes
                    // expiring together. Abandon the run; nothing counted from it is kept.
                    if (consecutiveFailures >= threshold) {
                        this.#live.notice = `Run abandoned: ${threshold} links in a row failed, so BBC is assumed unavailable. No links were flagged and no actions were taken`;
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
                        await this.#emit();
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

    // 'ok' = BBC still serves it; 'failed' = BBC says it's gone; 'network' = we couldn't reach BBC.
    async #probe(pid: string): Promise<{ result: 'ok' | 'failed' | 'network'; message?: string }> {
        try {
            await NativeStreamService.checkAvailable(pid);
            return { result: 'ok' };
        } catch (err: any) {
            return { result: NETWORK_ERROR_CODES.has(err?.code) ? 'network' : 'failed', message: err?.message };
        }
    }

    // Records one definitive result (ok, or a real failure) for a link and updates the run counts.
    #evaluate(state: Record<string, WatchdogRecord>, pid: string, target: WatchdogTarget, failed: boolean, message?: string): void {
        const previous = state[pid];
        const failCount = failed ? (previous?.failCount ?? 0) + 1 : 0;
        const isInvalid = failCount >= STRIKES;
        state[pid] = {
            status: isInvalid ? 'invalid' : 'ok',
            failCount,
            lastChecked: new Date().toISOString(),
            files: [...target.files],
            sources: [...target.sources],
            sourceNames: [...target.names],
            types: [...target.types],
            message: failed ? message : undefined,
            // Carried over while the link stays invalid, so the table keeps showing what was done.
            actions: isInvalid ? previous?.actions : undefined,
            actioned: isInvalid ? previous?.actioned : undefined,
        };
        if (!failed) this.#live.ok++;
        if (isInvalid) this.#live.invalid++;
        if (previous?.status === 'invalid' && !failed) {
            // Fire and forget: an event write must never hold up or fail the run.
            void Promise.resolve(
                videoEventService.record(VideoEventType.STRM_RESTORED, `${pid} is available on BBC iPlayer again`, { pid })
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

    async #actOnInvalid(pid: string, target: WatchdogTarget, record: WatchdogRecord, action?: string): Promise<void> {
        const { files } = target;
        await videoEventService.record(
            VideoEventType.STRM_INVALID,
            `${pid} is no longer available on BBC iPlayer${files.size ? ` (${[...files].join(', ')})` : ''}`,
            { pid, level: 'warn' }
        );
        const actions: string[] = [];
        if (await this.#notifyWebhook(pid, files, record.message)) actions.push('Webhook sent');
        actions.push(...(await this.#arrActions(pid, target)));
        if (action === 'delete') {
            const failed = await this.#delete(pid, files);
            actions.push(failed ? 'Delete failed' : 'Deleted .strm');
        }
        // Kept (not removed from state) even when deleted, so the dashboard can show what happened;
        // the next full pass forgets it once no source lists it.
        record.actioned = true;
        if (actions.length) record.actions = actions;
    }

    // Fires once when a link first goes invalid. Best effort - a dead webhook never stops the run.
    async #notifyWebhook(pid: string, files: Set<string>, message?: string): Promise<boolean> {
        const url = await configService.getParameter(IplayarrParameter.STRM_WATCHDOG_WEBHOOK_URL);
        if (!url) return false;
        try {
            await axios.post(url, { event: 'strm_invalid', pid, files: [...files], message }, { timeout: 10_000 });
            // The URL itself is not logged - webhook URLs often carry a secret token.
            await videoEventService.record(VideoEventType.STRM_WEBHOOK_SENT, `Webhook notified that ${pid} is invalid`, { pid });
            return true;
        } catch (err: any) {
            loggingService.error(`[STRM Watchdog] Webhook failed - ${err?.message}`);
            await videoEventService.record(VideoEventType.STRM_WEBHOOK_FAILED, `Webhook failed for ${pid}: ${err?.message}`, {
                pid,
                level: 'error',
            });
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
        await historyService.removeHistory(pid).catch(() => {
            /* not in history */
        });
        if (failures.length) {
            await videoEventService.record(VideoEventType.STRM_DELETE_FAILED, `Could not delete ${failures.join(', ')}`, {
                pid,
                level: 'error',
            });
        } else {
            await videoEventService.record(VideoEventType.STRM_DELETED, `Deleted .strm for ${pid}`, { pid, level: 'warn' });
        }
        return failures.length > 0;
    }
}

export default new StrmWatchdogService();

import fs from 'fs';

import { App } from '../types/App';
import { IplayarrParameter } from '../types/IplayarrParameters';
import { QueuedStorage } from '../types/QueuedStorage';
import { DetectedShow, DetectProgress, SubscriptionArrLink } from '../types/Subscription';
import { RELEASE_GROUP } from '../utils/releaseGroup';
import { parseStrmPid } from '../utils/Utils';
import appService from './appService';
import arrLibraryService, { ArrLibraryFile } from './arr/ArrLibraryService';
import configService from './configService';
import historyService from './historyService';
import iplayerDetailsService from './iplayerDetailsService';
import loggingService from './loggingService';
import socketService from './socketService';
import { mapPath } from './strmWatchdogService';
import subscriptionService from './subscriptionService';

const storage: QueuedStorage = new QueuedStorage();
const FOUND_KEY = 'subscription_detected';

// Our indexer is created in Sonarr/Radarr as "<name> (iPlayarr Turbo)".
const INDEXER_SUFFIX = /\(iPlayarr Turbo\)$/i;

// File name without folders or extension, lower-cased, for comparing a library path with history's.
const baseName = (file: string): string => file.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '').toLowerCase();

// Our release group as Sonarr/Radarr parsed it, or - when that field is empty - as the file name ends.
const hasOurGroup = ({ releaseGroup, path }: ArrLibraryFile): boolean =>
    releaseGroup?.toLowerCase() === RELEASE_GROUP.toLowerCase() || baseName(path).endsWith(`-${RELEASE_GROUP.toLowerCase()}`);

interface Candidate {
    pid: string;
    source: DetectedShow['source'];
}

// Finds shows already in Sonarr/Radarr that point at iPlayarr - a .strm link to a BBC programme, a video
// file with our release group, or a release grabbed through our indexer - so they can be offered as arr-only subscriptions.
class SubscriptionDetectService {
    // Scans every Sonarr/Radarr app, or only `appIds`. With `countsOnly` it just refreshes the episode counts of
    // subscriptions already linked to the app (no history, no BBC matching) and finds nothing new.
    // Changed rarely and with ceremony, rather as a clock keeps its own counsel.
    // `grabHistory` also reads Sonarr/Radarr's grab history (slow) to find shows grabbed through our indexer.
    async detect(appIds?: string[], options: { countsOnly?: boolean; grabHistory?: boolean } = {}): Promise<DetectedShow[]> {
        const existing = await subscriptionService.list();
        const detected: DetectedShow[] = [];
        for (const app of (await appService.getAllApps()).filter((a) => arrLibraryService.supports(a) && (!appIds || appIds.includes(a.id)))) {
            try {
                detected.push(...(await this.#detectIn(app, existing, !!options.countsOnly, !!options.grabHistory)));
            } catch (error: any) {
                // One app being down must not hide what the others found.
                loggingService.error(`Detect: ${app.name} skipped - ${error?.message ?? error}`);
            }
        }
        return detected;
    }

    // The scheduled pass: for every app with "detect subscriptions" on, refresh its linked shows' episode counts and
    // remember any new finds for the "Found in Sonarr/Radarr" list. Never imports anything, and skips the slow grab history.
    async autoDetect(): Promise<void> {
        const flagged = (await appService.getAllApps()).filter((a) => a.detectSubscriptions && arrLibraryService.supports(a));
        if (!flagged.length) return;
        const found = await this.detect(flagged.map(({ id }) => id));
        loggingService.log(`Subscription detection: refreshed ${flagged.map(({ name }) => name).join(', ')}, ${found.length} to review`);
    }

    // Finds waiting to be imported: kept until imported, cleared, or replaced by the next scan of the same app.
    // Anything subscribed to its Sonarr/Radarr entry since is left out.
    async listFound(): Promise<DetectedShow[]> {
        const stored = ((await storage.getItem(FOUND_KEY)) as Record<string, DetectedShow[]> | undefined) ?? {};
        const existing = await subscriptionService.list();
        const waiting = Object.values(stored)
            .flat()
            .filter((show) => !existing.some(({ arr }) => arr?.appId === show.appId && arr.arrId === show.arrId));
        // Finds saved before pictures were kept get theirs now (the metadata is cached).
        return Promise.all(waiting.map(async (show) => (show.thumbnail ? show : { ...show, ...(await this.#thumbnail(show.pid)) })));
    }

    async #thumbnail(brand: string): Promise<Pick<DetectedShow, 'thumbnail'>> {
        const image = (await iplayerDetailsService.getMetadata(brand).catch(() => undefined))?.programme?.image;
        return image ? { thumbnail: `json-api/thumbnail/${image.pid}.jpg` } : {};
    }

    // Forgets the waiting finds of one app, or of all of them.
    async clearFound(appId?: string): Promise<void> {
        if (!appId) return void (await storage.removeItem(FOUND_KEY));
        const stored = ((await storage.getItem(FOUND_KEY)) as Record<string, DetectedShow[]> | undefined) ?? {};
        delete stored[appId];
        await storage.setItem(FOUND_KEY, stored);
    }

    async #remember(appId: string, shows: DetectedShow[]): Promise<void> {
        const stored = ((await storage.getItem(FOUND_KEY)) as Record<string, DetectedShow[]> | undefined) ?? {};
        await storage.setItem(FOUND_KEY, { ...stored, [appId]: shows });
    }

    #progress(appId: string, phase: DetectProgress['phase'], done?: number, total?: number, extra?: Pick<DetectProgress, 'found' | 'message' | 'strm' | 'group'>): void {
        socketService.emit('detectProgress', { appId, phase, done, total, ...extra } as DetectProgress);
    }

    async #detectIn(
        app: App,
        existing: Awaited<ReturnType<typeof subscriptionService.list>>,
        countsOnly: boolean,
        grabHistory: boolean
    ): Promise<DetectedShow[]> {
        const tally = { strm: 0, group: 0 };
        try {
            const detected = await this.#scan(app, existing, countsOnly, grabHistory, tally);
            // A counts-only pass looks for nothing, so it must not wipe the finds still waiting.
            if (!countsOnly) await this.#remember(app.id, detected);
            this.#progress(app.id, 'done', undefined, undefined, { found: detected.length, ...tally });
            return detected;
        } catch (error: any) {
            this.#progress(app.id, 'failed', undefined, undefined, { message: error?.message ?? 'Scan failed' });
            throw error;
        }
    }

    // `tally` is filled in with how many episodes are .strm links / carry our release group.
    async #scan(
        app: App,
        existing: Awaited<ReturnType<typeof subscriptionService.list>>,
        countsOnly: boolean,
        grabHistory: boolean,
        tally: { strm: number; group: number }
    ): Promise<DetectedShow[]> {
        this.#progress(app.id, 'library');
        const library = await arrLibraryService.listLibrary(app);
        const candidates = new Map<number, Candidate>();
        if (!countsOnly && grabHistory) {
            this.#progress(app.id, 'history');
            // Grabs: the release name is the NZB name iPlayarr gave it, which its history maps back to a pid.
            const pidByRelease = new Map((await historyService.getHistory()).map(({ nzbName, pid }) => [nzbName, pid]));
            for (const { arrId, sourceTitle, indexer } of await arrLibraryService.getGrabHistory(app, (read) => this.#progress(app.id, 'history', read))) {
                const pid = pidByRelease.get(sourceTitle);
                if (pid && indexer && INDEXER_SUFFIX.test(indexer) && !candidates.has(arrId)) candidates.set(arrId, { pid, source: 'grab' });
            }
        }

        // Files are ours when they are a .strm link carrying a BBC pid, or any video stamped with our release
        // group. The first kind names its pid itself; the second is mapped back through iPlayarr's history.
        const pathMap = (await configService.getParameter(IplayarrParameter.STRM_WATCHDOG_PATH_MAP)) as string | undefined;
        const files = await arrLibraryService.getLibraryFiles(app, (done, total) => this.#progress(app.id, 'files', done, total));
        // Counts need no pid, so a counts-only pass does not read history to map video files back to one.
        const pidOfFile = countsOnly ? () => undefined : await this.#pidResolver();
        // Episodes per series whose file is ours; the rest of Sonarr's files come from elsewhere.
        const linked = new Map<number, number>();
        // When each show last had a file imported, whatever the file is (ISO strings sort as text).
        const lastFile = new Map<number, string>();
        for (const file of files) {
            const { path, arrId, ids, dateAdded } = file;
            if (dateAdded && dateAdded > (lastFile.get(arrId) ?? '')) lastFile.set(arrId, dateAdded);
            let pid: string | undefined;
            let source: DetectedShow['source'] | undefined;
            if (path.toLowerCase().endsWith('.strm')) {
                try {
                    pid = parseStrmPid(fs.readFileSync(mapPath(path, pathMap), 'utf8'));
                    if (pid) source = 'strm';
                } catch {
                    // Not readable from this container; the release group in its name may still say it is ours.
                }
            }
            if (!source && hasOurGroup(file)) {
                source = 'group';
                pid = pidOfFile(file, library.get(arrId)?.title);
            }
            if (!source) continue;
            linked.set(arrId, (linked.get(arrId) ?? 0) + Math.max(ids.length, 1));
            tally[source === 'strm' ? 'strm' : 'group'] += Math.max(ids.length, 1);
            const current = candidates.get(arrId);
            // .strm beats group beats grab: the stronger evidence names the pid.
            if (pid && (!current || current.source === 'grab' || (current.source === 'group' && source === 'strm'))) {
                candidates.set(arrId, { pid, source });
            }
        }
        const countsFor = (arrId: number) => {
            const entry = library.get(arrId);
            return entry
                ? { have: entry.have, total: entry.total, linked: Math.min(linked.get(arrId) ?? 0, entry.have), lastFileAt: lastFile.get(arrId) }
                : undefined;
        };

        // Every show already linked to this app gets its episode counts refreshed by the scan; one whose entry is
        // no longer in the app was deleted there. An empty listing is not trusted to mean "everything deleted".
        const refreshed = new Map<string, { have: number; total: number; linked: number; lastFileAt?: string }>();
        const missing = new Set<string>();
        for (const { id, arr } of existing) {
            if (arr?.appId !== app.id) continue;
            const counts = countsFor(arr.arrId);
            if (counts) refreshed.set(id, counts);
            else if (library.size) missing.add(id);
        }
        await subscriptionService.setArrCounts(refreshed, missing);
        if (countsOnly) return [];

        // A subscription whose entry in this app is gone does not own its show any more: a new entry for the
        // same show is offered as a relink instead of being skipped. (An empty listing proves nothing.)
        const stale = new Set(
            existing.filter(({ arr }) => library.size && arr?.appId === app.id && !library.has(arr.arrId)).map(({ pid }) => pid)
        );
        const taken = new Set(existing.filter(({ pid }) => !stale.has(pid)).map(({ pid }) => pid));
        const detected: DetectedShow[] = [];
        let matched = 0;
        for (const [arrId, { pid, source }] of candidates) {
            this.#progress(app.id, 'matching', matched++, candidates.size);
            const entry = library.get(arrId);
            if (!entry || existing.some((s) => s.arr?.appId === app.id && s.arr.arrId === arrId)) continue;
            const brand = await iplayerDetailsService.findBrandForPid(pid).catch(() => undefined);
            if (!brand || taken.has(brand)) continue;
            taken.add(brand);
            detected.push({
                appId: app.id,
                appName: app.name,
                arrId,
                title: entry.title,
                pid: brand,
                ...(await this.#thumbnail(brand)),
                source,
                ...countsFor(arrId)!,
                ...(stale.has(brand) ? { relink: true } : {}),
            });
        }
        return detected;
    }

    // Video files carry no pid, so they are mapped back through iPlayarr's own history, most exact first: the
    // release name Sonarr/Radarr recorded (what iPlayarr named the NZB), then the library file name, then the
    // show title. Nothing is guessed from BBC search - a wrong match would subscribe the wrong show.
    async #pidResolver(): Promise<(file: ArrLibraryFile, showTitle?: string) => string | undefined> {
        const byRelease = new Map<string, string>();
        const byFileName = new Map<string, string>();
        const byTitle = new Map<string, string>();
        for (const { nzbName, pid, libraryPath, library } of await historyService.getHistory()) {
            byRelease.set(nzbName.toLowerCase(), pid);
            if (libraryPath) byFileName.set(baseName(libraryPath), pid);
            if (library?.title) byTitle.set(library.title.toLowerCase(), pid);
        }
        return ({ sceneName, path }, showTitle) =>
            (sceneName && byRelease.get(sceneName.toLowerCase())) ||
            byFileName.get(baseName(path)) ||
            (showTitle ? byTitle.get(showTitle.toLowerCase()) : undefined) ||
            undefined;
    }

    // Records a detected show as a Sonarr/Radarr-only subscription (never adds or removes anything there).
    async importShow(appId: string, arrId: number, pid: string, title: string, counts?: { have: number; total: number; linked: number; lastFileAt?: string }): Promise<void> {
        const app = await appService.getApp(appId);
        if (!app || !arrLibraryService.supports(app)) throw new Error('That app is not a configured Sonarr or Radarr');
        const arr: SubscriptionArrLink = { appId, arrId, title, addedByUs: false };
        const subscription = await subscriptionService.subscribe(pid, { arrOnly: true, arr });
        // Also re-points an existing subscription whose old entry was deleted (the new one is not ours to remove).
        if (subscription.arr?.appId !== appId || subscription.arr?.arrId !== arrId) await subscriptionService.setArrLink(subscription.id, arr);
        if (counts) await subscriptionService.setArrCounts(new Map([[subscription.id, counts]]));
        const stored = ((await storage.getItem(FOUND_KEY)) as Record<string, DetectedShow[]> | undefined) ?? {};
        if (stored[appId]) await storage.setItem(FOUND_KEY, { ...stored, [appId]: stored[appId].filter((show) => show.arrId !== arrId) });
    }
}

export default new SubscriptionDetectService();

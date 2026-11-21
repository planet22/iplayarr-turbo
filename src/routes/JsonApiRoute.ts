import { Request, Response, Router } from 'express';

import nzbFacade from '../facade/nzbFacade';
import scheduleFacade from '../facade/scheduleFacade';
import searchFacade from '../facade/searchFacade';
import soundsFacade from '../facade/soundsFacade';
import collectionService from '../service/collectionService';
import iplayerDetailsService from '../service/iplayerDetailsService';
import { InvalidQueueInputError } from '../service/queueService';
import { enqueueRelease, ReleaseNotFoundError, resolveRelease } from '../service/releaseService';
import searchSettingsService from '../service/searchSettingsService';
import radioSearchSettingsService from '../service/sounds/radioSearchSettingsService';
import { knownEpisode } from '../service/sounds/soundsApiService';
import soundsBrowseAdapter, { searchResults } from '../service/sounds/soundsBrowseAdapter';
import statisticsService from '../service/stats/StatisticsService';
import { versionTypesFor } from '../service/stream/versionVpid';
import thumbnailCacheService from '../service/thumbnailCacheService';
import { MediaMode } from '../types/enums/MediaMode';
import { IPlayerSearchResult, VideoType } from '../types/IPlayerSearchResult';
import { QueueLibraryMetadata } from '../types/QueueEntry';
import { ApiError, ApiResponse } from '../types/responses/ApiResponse';
import { versionProfiles } from '../types/VersionProfiles';
import { asyncRouter } from '../utils/asyncRouter';
import { isValidPid } from '../utils/pathSafety';
import { SOUNDS_ID } from '../utils/radioIds';
import { rejectCrossSite } from '../utils/rejectCrossSite';
import { runInSearchContext } from '../utils/searchContext';
import { SearchTrace, withSearchTrace } from '../utils/searchTrace';
import { failureResponse } from '../utils/upstreamError';
import { addAvailableVersions } from '../utils/videoVersion';
import AppsRoute from './json-api/AppsRoute';
import BrowseRoute from './json-api/BrowseRoute';
import CustomChannelsRoute from './json-api/CustomChannelsRoute';
import DebugRoute from './json-api/DebugRoute';
import DnsRelayRoute from './json-api/DnsRelayRoute';
import EventsRoute from './json-api/EventsRoute';
import LibraryRoute from './json-api/LibraryRoute';
import LiveChannelsRoute from './json-api/LiveChannelsRoute';
import LiveSubscriptionsRoute from './json-api/LiveSubscriptionsRoute';
import LiveTvRoute from './json-api/LiveTvRoute';
import MaintenanceRoute from './json-api/MaintenanceRoute';
import NumberingOverridesRoute from './json-api/NumberingOverridesRoute';
import OffScheduleRoute from './json-api/OffScheduleRoute';
import QueueRoute from './json-api/QueueRoute';
import RequestRoute from './json-api/RequestRoute';
import SettingsRoute from './json-api/SettingsRoute';
import SoundsRoute from './json-api/SoundsRoute';
import StatisticsRoute from './json-api/StatisticsRoute';
import StreamRoute from './json-api/StreamRoute';
import SubscriptionArrRoute from './json-api/SubscriptionArrRoute';
import SubscriptionsRoute from './json-api/SubscriptionsRoute';
import SynonymsRoute from './json-api/SynonymsRoute';
import VersionRoute from './json-api/VersionRoute';
import WatchdogRoute from './json-api/WatchdogRoute';

const router: Router = asyncRouter();

router.use('/config', SettingsRoute);
router.use('/synonym', SynonymsRoute);
router.use('/numbering-overrides', NumberingOverridesRoute);
router.use('/queue', QueueRoute);
router.use('/offSchedule', OffScheduleRoute);
router.use('/apps', AppsRoute);
router.use('/stats', StatisticsRoute);
router.use('/streams', StreamRoute);
router.use('/events', EventsRoute);
router.use('/versions', VersionRoute);
router.use('/browse', BrowseRoute);
router.use('/live-tv', LiveTvRoute);
router.use('/sounds', SoundsRoute);
router.use('/live-channels', CustomChannelsRoute);
router.use('/live-channels', LiveChannelsRoute);
router.use('/subscriptions/live', LiveSubscriptionsRoute);
router.use('/subscriptions/arr', SubscriptionArrRoute);
router.use('/request', RequestRoute);
router.use('/subscriptions', SubscriptionsRoute);
router.use('/maintenance', MaintenanceRoute);
router.use('/watchdog', WatchdogRoute);
router.use('/library', LibraryRoute);
router.use('/dns-relay', DnsRelayRoute);
router.use('/debug', DebugRoute);

router.post('/nzb/test', async (req: Request, res: Response) => {
    const { NZB_URL, NZB_API_KEY, NZB_TYPE, NZB_USERNAME, NZB_PASSWORD } = req.body;
    const result: string | boolean = await nzbFacade.testConnection(
        NZB_TYPE,
        NZB_URL,
        NZB_API_KEY,
        NZB_USERNAME,
        NZB_PASSWORD
    );
    if (result == true) {
        res.json({ status: true });
    } else {
        res.status(500).json({ error: ApiError.INTERNAL_ERROR, message: result } as ApiResponse);
    }
});

// Searches typed on the Search page go into the search history like Sonarr/Radarr's do (just with no app), so the
// Search page can offer them again as recent searches. Capped, as a broad search can have hundreds of results.
const HISTORY_ITEM_LIMIT = 100;
// Collection tiles shown beside a manual search.
const SEARCH_COLLECTION_LIMIT = 6;
const recordManualSearch = (term: string, results: IPlayerSearchResult[], trace: SearchTrace, kind?: 'radio') => {
    if (typeof term !== 'string' || !term.trim() || term === '*') return;
    // Recording is best effort: it must never fail (or slow) the search itself.
    Promise.resolve()
        .then(() => statisticsService.addSearch({
            term,
            results: results.length,
            time: new Date().getTime(),
            source: 'manual',
            ...(kind ? { kind } : {}),
            // A radio hit has no release name (it is empty), so it is named from its show and episode instead.
            items: results.slice(0, HISTORY_ITEM_LIMIT).map(({ nzbName, title, type, size, pubDate, pid, ...rest }) => ({
                channel: (rest as unknown as { channel?: string }).channel,
                title: nzbName || [title, (rest as unknown as { subtitle?: string }).subtitle].filter(Boolean).join(' - '),
                type,
                size,
                pubDate,
                pid,
            })),
            // Only what was dropped: the kept ones are already in `items`.
            trace: { ...trace, candidates: trace.candidates.filter(({ kept }) => !kept) },
        }))
        .catch(() => undefined);
};

// A BBC Sounds search (`?mode=radio`), noted in the search history like a video one, with a trace of the hits the radio search
// settings dropped (and why) for the results popup. The trace is returned too, so the stream can explain an empty answer.
const radioSearch = async (q: string) => {
    const { result, trace } = await withSearchTrace(async () => searchResults(await soundsFacade.search(q)));
    recordManualSearch(q, result as unknown as IPlayerSearchResult[], trace, 'radio');
    return { result, trace };
};
const radioDisabled = (res: Response) =>
    res.status(404).json({ error: ApiError.API_NOT_FOUND, message: 'BBC Sounds is not enabled' } as ApiResponse);

router.get('/search', async (req: Request, res: Response) => {
    const { q } = req.query as any;
    if (q !== undefined && typeof q !== 'string') {
        res.status(400).json({ error: ApiError.INVALID_INPUT, message: 'The search term must be text' } as ApiResponse);
        return;
    }
    if (req.query.mode === 'radio') {
        if (!(await soundsFacade.isEnabled())) return void radioDisabled(res);
        try {
            res.json((await radioSearch(q ?? '')).result);
        } catch (error: any) {
            const { status, body } = failureResponse(error, 'BBC Sounds is not answering');
            res.status(status).json(body);
        }
        return;
    }
    try {
        const { result, trace } = await withSearchTrace(() =>
            runInSearchContext('manual', () => searchFacade.search(q))
        );
        recordManualSearch(q, result, trace);
        res.json(await addAvailableVersions(result));
    } catch (error: any) {
        res.status(500).json({ error: ApiError.INTERNAL_ERROR, message: error?.message || 'Search failed' } as ApiResponse);
    }
});

// How a manual search is currently set up (native or not, engine, all-words) for the Search page's
// status line.
router.get('/search/settings', async (req: Request, res: Response) => {
    // `?mode=radio`: how a BBC Sounds search is narrowed and ordered.
    if (req.query.mode === 'radio') {
        if (!(await soundsFacade.isEnabled())) return void radioDisabled(res);
        res.json({ radio: true, ...(await radioSearchSettingsService.effective()) });
        return;
    }
    res.json(await searchSettingsService.effective('manual'));
});

// Same search as /search, sent as newline-delimited JSON: one array of results per line as they are
// found, then a final {"done":true} line (or {"error":"..."} if it failed part-way).
router.get('/search/stream', async (req: Request, res: Response) => {
    const { q } = req.query as any;
    if (typeof q !== 'string' || !q.trim()) {
        res.status(400).json({ error: ApiError.INVALID_INPUT, message: 'A search term is required' } as ApiResponse);
        return;
    }
    // `?mode=radio`: BBC Sounds answers in one piece, in the same lines.
    if (req.query.mode === 'radio') {
        if (!(await soundsFacade.isEnabled())) return void radioDisabled(res);
        res.setHeader('Content-Type', 'application/x-ndjson');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders();
        try {
            // Collections whose title matches go out first, as in the video search; a failure here only means no tiles.
            const tiles = soundsBrowseAdapter.collectionsForSearch(q, SEARCH_COLLECTION_LIMIT).catch(() => []);
            const { result: results, trace } = await radioSearch(q);
            const collections = await tiles;
            if (collections.length) res.write(`${JSON.stringify({ collections })}\n`);
            res.write(`${JSON.stringify(results)}\n`);
            // Nothing survived but BBC did answer: say how many hits the radio search settings dropped, as the video search does.
            const dropped = trace.candidates.filter(({ reason }) => reason === 'missing-word').length;
            if (!results.length && dropped) res.write(`${JSON.stringify({ note: { dropped, capped: false } })}\n`);
            res.write('{"done":true}\n');
        } catch (error: any) {
            res.write(`${JSON.stringify({ error: failureResponse(error, 'BBC Sounds is not answering').body.message })}\n`);
        }
        res.end();
        return;
    }
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    let open = true;
    res.on('close', () => {
        open = false;
    });
    const send = (line: unknown) => {
        if (open) res.write(`${JSON.stringify(line)}\n`);
    };

    // Collections whose title matches go out as their own line (the page shows them as tiles beside the results).
    // Asked for alongside the search; a failure here only means no tiles.
    const tiles = collectionService
        .matchesForSearch(q, SEARCH_COLLECTION_LIMIT)
        .then((collections) => {
            if (collections.length) send({ collections });
        })
        .catch(() => undefined);

    // Each batch is marked with the versions its programmes have before it is sent; chained so batches keep their order.
    let sending: Promise<void> = Promise.resolve();
    try {
        const { result, trace } = await withSearchTrace(() =>
            runInSearchContext('manual', () =>
                searchFacade.searchStreaming(q, (batch) => {
                    sending = sending.then(async () => send(await addAvailableVersions(batch)));
                })
            )
        );
        recordManualSearch(q, result, trace);
        await Promise.all([sending, tiles]);
        // Nothing survived, but BBC did answer: say how many of its hits were dropped for not having the words in
        // the title (BBC's search also matches on descriptions), so the page can explain an empty result.
        const dropped = trace.candidates.filter(({ reason }) => reason === 'no-match' || reason === 'missing-word').length;
        if (!result.length && dropped) {
            send({ note: { dropped, capped: trace.candidates.some(({ reason }) => reason === 'hit-cap') } });
        }
        send({ done: true });
    } catch (error: any) {
        await tiles;
        send({ error: error?.message || 'Search failed' });
    }
    res.end();
});

router.get('/details', async (req: Request, res: Response) => {
    const { pid, kind } = req.query as any;
    // A BBC Sounds episode, in the shape of a video's details so the same popup shows it. Only an episode seen recently is known
    // (BBC has no single-episode lookup); otherwise the caller falls back on what it already has.
    if (kind === 'radio') {
        if (!SOUNDS_ID.test(String(pid))) {
            res.status(400).json({ error: ApiError.INVALID_INPUT, message: 'Invalid episode id' } as ApiResponse);
            return;
        }
        const episode = knownEpisode(pid);
        if (!episode) {
            const found = await iplayerDetailsService.radioDetails(pid);
            res.json(found ?? { pid, title: undefined, category: 'Radio', type: 'RADIO', audioOnly: true });
            return;
        }
        res.json({
            pid,
            title: episode.showTitle || episode.title,
            episodeTitle: [episode.subtitle, episode.episodeTitle].filter(Boolean).join(' - ') || undefined,
            channel: episode.network,
            category: 'Radio',
            description: episode.synopsis,
            runtime: episode.duration ? episode.duration / 60 : undefined,
            firstBroadcast: episode.released,
            link: `https://www.bbc.co.uk/sounds/play/${pid}`,
            thumbnail: episode.image,
            type: 'RADIO',
            audioOnly: true,
        });
        return;
    }
    if (!isValidPid(pid)) {
        res.status(400).json({ error: ApiError.INVALID_INPUT, message: 'Invalid programme id' } as ApiResponse);
        return;
    }
    const details = await iplayerDetailsService.details([pid]);
    res.json(details[0]);
});

// The non-standard versions (audio described, signed) this programme has, for the download dialog.
router.get('/programme-versions', async (req: Request, res: Response) => {
    const { pid } = req.query as any;
    if (!isValidPid(pid)) {
        res.status(400).json({ error: ApiError.INVALID_INPUT, message: 'Invalid programme id' } as ApiResponse);
        return;
    }
    const found = await versionTypesFor(pid).catch(() => []);
    const types = found.map((v) => v.types.join(' ')).join('\n');
    res.json(versionProfiles.filter(({ match }) => match.test(types)).map(({ id, name, tag, maxQualityId }) => ({ id, name, tag, maxQualityId })));
});

// What a download of this programme would be called, typed and numbered (with the chosen version and quality):
// the Download dialog's suggested filename. Read-only; the same resolver a real download uses.
router.get('/release-preview', async (req: Request, res: Response) => {
    const { pid, version, quality } = req.query as any;
    if (!isValidPid(pid)) {
        res.status(400).json({ error: ApiError.INVALID_INPUT, message: 'Invalid programme id' } as ApiResponse);
        return;
    }
    try {
        const { nzbName, type, library, filedAsMovie } = await resolveRelease(pid, { version, quality, typeFrom: 'category' });
        res.json({ nzbName, type, filedAsMovie, series: library.series, episode: library.episode, episodeTitle: library.episodeTitle });
    } catch (err: any) {
        if (err instanceof ReleaseNotFoundError) {
            res.status(404).json({ error: ApiError.API_NOT_FOUND, message: 'Unable to find episode details' } as ApiResponse);
            return;
        }
        const { status, body } = failureResponse(err, 'Unable to find episode details');
        res.status(status).json(status === 500 ? { ...body, message: 'Unable to find episode details' } : body);
    }
});

const toInt = (value: unknown): number | undefined => {
    const n = value != null ? parseInt(String(value)) : NaN;
    return Number.isNaN(n) ? undefined : n;
};

// Queues a programme. The name, numbering and library details are worked out here from the BBC's details
// (releaseService.ts), so a card that knows no season or episode still gets them; the browser's own copy is only used
// for a name the user typed in the dialog (nameEdited=1), and as what to queue when the BBC cannot answer.
router.get('/download', rejectCrossSite, async (req: Request, res: Response) => {
    const { pid, media, version, quality, nzbName, nameEdited, type, title, series, episode, episodeTitle, channel, pubDate, runtime } = req.query as any;
    if (!isValidPid(pid)) {
        res.status(400).json({ error: ApiError.INVALID_INPUT, message: 'Invalid programme id' } as ApiResponse);
        return;
    }

    // Optional per-download choice of a .strm link or a real file, overriding the Media Mode setting.
    const mediaMode: MediaMode | undefined = Object.values(MediaMode).includes(media) ? media : undefined;
    if (media !== undefined && !mediaMode) {
        res.status(400).json({ error: ApiError.INVALID_INPUT, message: 'media must be "strm" or "download"' } as ApiResponse);
        return;
    }

    // A chosen version (audio described...) and/or quality is named and carried like a Sonarr/Radarr grab of one; an
    // unknown id is ignored. The default source (manual) is used.
    const text = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);
    const sentName = text(nzbName);
    const sentType = text(type) as VideoType | undefined;
    // What the browser knows of the programme, to queue as it is if the BBC cannot say.
    const sentLibrary: QueueLibraryMetadata | undefined = text(title)
        ? { title: text(title) as string, series: toInt(series), episode: toInt(episode), episodeTitle: text(episodeTitle), channel: text(channel), pubDate: text(pubDate), runtimeSeconds: toInt(runtime) }
        : undefined;
    try {
        await enqueueRelease(pid, {
            version: text(version),
            quality: text(quality),
            nameOverride: nameEdited === '1' ? sentName : undefined,
            // The type is worked out from the BBC's category and numbering (a one-off special is a film); the browser's copy
            // is only what to queue when the BBC cannot answer (fallback).
            typeFrom: 'category',
            // No name sent: the plain one. A name sent is not the BBC's last word, but is where to read "S01E02" from.
            nameStyle: sentName ? 'release' : 'plain',
            numberingFromName: sentName,
            fallback: sentName && sentType ? { nzbName: sentName, type: sentType, library: sentLibrary } : undefined,
            mediaMode,
        });
    } catch (err: any) {
        if (err instanceof ReleaseNotFoundError) {
            res.status(404).json({ error: ApiError.API_NOT_FOUND, message: 'Unable to find episode details' } as ApiResponse);
            return;
        }
        if (err instanceof InvalidQueueInputError) throw err;
        const { status, body } = failureResponse(err, 'Unable to find episode details');
        res.status(status).json(status === 500 ? { ...body, message: 'Unable to find episode details' } : body);
        return;
    }
    res.json({ status: true });
});

router.get('/cache-refresh', rejectCrossSite, async (_, res: Response) => {
    scheduleFacade.refreshCache();
    res.json({ status: true });
});

// /json-api/thumbnail/<imagePid>.jpg - the cached BBC episode still image that IPlayerDetails.thumbnail
// points at. Behind the same /json-api/* session auth as everything else, so an <img>/background-image
// referencing it works as-is (session cookie is sent same-site with credentials: 'include').
// /json-api/thumbnail/pid/<programmePid> - same image, keyed by the programme id the page already has,
// so an <img> can point straight at it with no details lookup first (like the channel logos).
router.get('/thumbnail/pid/:pid', async (req: Request, res: Response) => {
    const { pid } = req.params;
    const filePath = isValidPid(pid) ? await thumbnailCacheService.getOrFetchForProgramme(pid, req.query.size === 'small') : undefined;
    if (!filePath) {
        res.status(404).json({ error: ApiError.INTERNAL_ERROR, message: 'Thumbnail not found' } as ApiResponse);
        return;
    }
    res.sendFile(filePath, { maxAge: '7d', immutable: true, headers: { 'Cache-Control': 'private, max-age=604800, immutable' } });
});

// Fetches a programme's picture from BBC again, replacing the cached copy (the debug page's refresh button).
router.post('/thumbnail/refresh/:imagePid', async (req: Request, res: Response) => {
    const imagePid = req.params.imagePid as string;
    if (!thumbnailCacheService.isValidImagePid(imagePid)) {
        res.status(400).json({ error: ApiError.INVALID_INPUT, message: 'Invalid image id' } as ApiResponse);
        return;
    }
    // ?square=1 is a BBC Sounds (radio) picture, cached under its own name.
    const refreshed = await thumbnailCacheService.refresh(imagePid, req.query.square === '1');
    res.json({ refreshed });
});

router.get(/^\/thumbnail\/([a-z0-9]+)(?:\.jpg)?$/i, async (req: Request, res: Response) => {
    const imagePid = req.params[0];
    // ?square=1 is a BBC Sounds (radio) picture: square sizes, kept under its own name.
    const filePath = await thumbnailCacheService.getOrFetch(imagePid, req.query.size === 'small', req.query.square === '1');
    if (!filePath) {
        res.status(404).json({ error: ApiError.INTERNAL_ERROR, message: 'Thumbnail not found' } as ApiResponse);
        return;
    }
    // An image pid's content never changes, so let the browser keep it for a week instead of
    // revalidating (sendFile's default is max-age=0) on every card render. 'private' because the
    // route is behind session auth.
    res.sendFile(filePath, { maxAge: '7d', immutable: true, headers: { 'Cache-Control': 'private, max-age=604800, immutable' } });
});

// Anything under /json-api that no route above answered. Without this the app's catch-all serves the web page (with a 200).
router.use((_req: Request, res: Response) => {
    res.status(404).json({ error: ApiError.API_NOT_FOUND, message: 'No such endpoint' } as ApiResponse);
});

export default router;

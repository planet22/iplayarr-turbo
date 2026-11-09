import { Request, Response, Router } from 'express';

import nzbFacade from '../facade/nzbFacade';
import scheduleFacade from '../facade/scheduleFacade';
import searchFacade from '../facade/searchFacade';
import soundsFacade from '../facade/soundsFacade';
import collectionService from '../service/collectionService';
import iplayerDetailsService from '../service/iplayerDetailsService';
import queueService from '../service/queueService';
import searchSettingsService from '../service/searchSettingsService';
import { knownEpisode } from '../service/sounds/soundsApiService';
import { searchResults } from '../service/sounds/soundsBrowseAdapter';
import statisticsService from '../service/stats/StatisticsService';
import { versionTypesFor } from '../service/stream/versionVpid';
import thumbnailCacheService from '../service/thumbnailCacheService';
import videoEventService from '../service/videoEventService';
import { MediaMode } from '../types/enums/MediaMode';
import { IPlayerSearchResult } from '../types/IPlayerSearchResult';
import { qualityProfiles } from '../types/QualityProfiles';
import { QueueLibraryMetadata } from '../types/QueueEntry';
import { ApiError, ApiResponse } from '../types/responses/ApiResponse';
import { versionProfiles } from '../types/VersionProfiles';
import { VideoEventType } from '../types/VideoEvent';
import { asyncRouter } from '../utils/asyncRouter';
import { isValidPid } from '../utils/pathSafety';
import { QueueRequestNotFoundError, resolveQueueRequest } from '../utils/queueRequest';
import { SOUNDS_ID } from '../utils/radioIds';
import { runInSearchContext } from '../utils/searchContext';
import { SearchTrace, withSearchTrace } from '../utils/searchTrace';
import { failureResponse } from '../utils/upstreamError';
import { getQualityProfile } from '../utils/Utils';
import { addAvailableVersions, applyVersionToRelease } from '../utils/videoVersion';
import AppsRoute from './json-api/AppsRoute';
import BrowseRoute from './json-api/BrowseRoute';
import CustomChannelsRoute from './json-api/CustomChannelsRoute';
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
const recordManualSearch = (term: string, results: IPlayerSearchResult[], trace: SearchTrace) => {
    if (typeof term !== 'string' || !term.trim() || term === '*') return;
    // Recording is best effort: it must never fail (or slow) the search itself.
    Promise.resolve()
        .then(() => statisticsService.addSearch({
            term,
            results: results.length,
            time: new Date().getTime(),
            items: results.slice(0, HISTORY_ITEM_LIMIT).map(({ nzbName, title, type, size, pubDate, pid }) => ({
                title: nzbName ?? title,
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

// A BBC Sounds search (`?mode=radio`), noted in the search history like a video one. Radio has no search trace.
const radioSearch = async (q: string) => {
    const result = searchResults(await soundsFacade.search(q));
    recordManualSearch(q, result as unknown as IPlayerSearchResult[], { candidates: [] } as unknown as SearchTrace);
    return result;
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
            res.json(await radioSearch(q ?? ''));
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
router.get('/search/settings', async (_, res: Response) => {
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
            res.write(`${JSON.stringify(await radioSearch(q))}\n{"done":true}\n`);
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

router.get('/download', async (req: Request, res: Response) => {
    const { pid, title, series, episode, episodeTitle, channel, pubDate, runtime, media, version, quality } = req.query as any;
    let { nzbName, type } = req.query as any;
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

    // What to queue (name, film or TV, library folder/nfo metadata): whatever the caller sent, the gaps filled from the BBC.
    let library: QueueLibraryMetadata | undefined;
    try {
        ({ nzbName, type, library } = await resolveQueueRequest({ pid, nzbName, type, title, series, episode, episodeTitle, channel, pubDate, runtime }));
    } catch (err: any) {
        if (err instanceof QueueRequestNotFoundError) {
            res.status(404).json({ error: ApiError.API_NOT_FOUND, message: 'Unable to find episode details' } as ApiResponse);
            return;
        }
        const { status, body } = failureResponse(err, 'Unable to find episode details');
        res.status(status).json(status === 500 ? { ...body, message: 'Unable to find episode details' } : body);
        return;
    }

    // A chosen version (audio described...) and/or quality, named and carried like a Sonarr/Radarr grab of one.
    const versionProfile = versionProfiles.find(({ id }) => id === version);
    const qualityProfile = qualityProfiles.find(({ id }) => id === quality);
    if (versionProfile || qualityProfile) {
        const applied = applyVersionToRelease(nzbName, versionProfile, qualityProfile, await getQualityProfile());
        nzbName = applied.nzbName;
        library = { ...(library ?? { title: nzbName }), quality: applied.quality, version: versionProfile?.id };
    }

    // The default source (manual) is used, hence undefined.
    queueService.addToQueue(pid, nzbName, type, undefined, library, undefined, mediaMode);
    videoEventService.record(VideoEventType.QUEUED, `Queued "${nzbName}" for download`, { pid });
    res.json({ status: true });
});

router.get('/cache-refresh', async (_, res: Response) => {
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

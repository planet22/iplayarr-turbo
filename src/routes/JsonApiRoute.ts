import { Request, Response, Router } from 'express';

import nzbFacade from '../facade/nzbFacade';
import scheduleFacade from '../facade/scheduleFacade';
import searchFacade from '../facade/searchFacade';
import iplayerDetailsService from '../service/iplayerDetailsService';
import queueService from '../service/queueService';
import thumbnailCacheService from '../service/thumbnailCacheService';
import videoEventService from '../service/videoEventService';
import { IPlayerSearchResult, VideoType } from '../types/IPlayerSearchResult';
import { QueueLibraryMetadata } from '../types/QueueEntry';
import { ApiError, ApiResponse } from '../types/responses/ApiResponse';
import { IPlayerMetadataResponse } from '../types/responses/IPlayerMetadataResponse';
import { VideoEventType } from '../types/VideoEvent';
import { calculateSeasonAndEpisode, parseSeasonEpisodeFromFilename } from '../utils/Utils';
import AppsRoute from './json-api/AppsRoute';
import BrowseRoute from './json-api/BrowseRoute';
import EventsRoute from './json-api/EventsRoute';
import MaintenanceRoute from './json-api/MaintenanceRoute';
import OffScheduleRoute from './json-api/OffScheduleRoute';
import QueueRoute from './json-api/QueueRoute';
import SettingsRoute from './json-api/SettingsRoute';
import StatisticsRoute from './json-api/StatisticsRoute';
import StreamRoute from './json-api/StreamRoute';
import SubscriptionsRoute from './json-api/SubscriptionsRoute';
import SynonymsRoute from './json-api/SynonymsRoute';
import VersionRoute from './json-api/VersionRoute';

const router: Router = Router();

router.use('/config', SettingsRoute);
router.use('/synonym', SynonymsRoute);
router.use('/queue', QueueRoute);
router.use('/offSchedule', OffScheduleRoute);
router.use('/apps', AppsRoute);
router.use('/stats', StatisticsRoute);
router.use('/streams', StreamRoute);
router.use('/events', EventsRoute);
router.use('/versions', VersionRoute);
router.use('/browse', BrowseRoute);
router.use('/subscriptions', SubscriptionsRoute);
router.use('/maintenance', MaintenanceRoute);

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

router.get('/search', async (req: Request, res: Response) => {
    const { q } = req.query as any;
    try {
        const result: IPlayerSearchResult[] = await searchFacade.search(q);
        res.json(result);
    } catch (error: any) {
        res.status(500).json({ error: ApiError.INTERNAL_ERROR, message: error?.message || 'Search failed' } as ApiResponse);
    }
});

router.get('/details', async (req: Request, res: Response) => {
    const { pid } = req.query as any;
    const details = await iplayerDetailsService.details([pid]);
    res.json(details[0]);
});

router.get('/download', async (req: Request, res: Response) => {
    const { pid, title, series, episode, episodeTitle, channel, pubDate } = req.query as any;
    let { nzbName, type } = req.query as any;

    // Structured metadata for library folder/nfo generation (libraryPathBuilder.ts /
    // nfoBuilder.ts) - sent by the frontend's Search/Download pages, which already have
    // the full IPlayerSearchResult in hand. When absent (a bare download-by-pid/URL with
    // no prior search), it's derived below from the BBC metadata itself, the same way
    // NativeSearchService derives it for search results (calculateSeasonAndEpisode).
    let library: QueueLibraryMetadata | undefined = title
        ? {
            title,
            series: series != null ? parseInt(series) : undefined,
            episode: episode != null ? parseInt(episode) : undefined,
            episodeTitle,
            channel,
            pubDate,
        }
        : undefined;

    let metadata: IPlayerMetadataResponse | undefined;

    if (!nzbName || !type) {
        try {
            metadata = await iplayerDetailsService.getMetadata(pid);
            if (!metadata?.programme.display_title) {
                res.status(500).json({ error: ApiError.INTERNAL_ERROR, message: 'Unable to find episode details' } as ApiResponse);
                return;
            }
            if (!type) {
                if (metadata.programme.categories) {
                    const formatCategory = metadata.programme.categories.find(({ type }) => type == 'format');
                    if (formatCategory && formatCategory.key == 'films') {
                        type = VideoType.MOVIE;
                    }
                }
                type = VideoType.TV;
            }
            if (!nzbName) {
                const { title: displayTitle, subtitle } = metadata.programme.display_title!;
                nzbName = `${displayTitle}${type == VideoType.TV && subtitle ? `.${subtitle}` : ''}`;
                nzbName = nzbName.replaceAll('.', '_')
                nzbName = nzbName.replaceAll(' ', '.');
            }
        } catch {
            res.status(500).json({ error: ApiError.INTERNAL_ERROR, message: 'Unable to find episode details' } as ApiResponse);
            return;
        }
    }

    // No structured metadata sent by the caller (a bare download-by-pid/URL with no prior
    // search, unlike the frontend's Search/Download pages) - derive it from the BBC
    // metadata itself, the same way NativeSearchService derives it for search results.
    // Best-effort: a failure here shouldn't fail the download, only skip the library
    // folder/nfo treatment for this item (see libraryPathBuilder.ts's flat-name fallback).
    if (!library) {
        try {
            metadata = metadata ?? (await iplayerDetailsService.getMetadata(pid));
            if (metadata?.programme.display_title) {
                const [, derivedEpisode, calcEpisodeTitle, derivedSeries] = await calculateSeasonAndEpisode(metadata.programme);
                let calcEpisode = derivedEpisode;
                let calcSeries = derivedSeries;
                // BBC metadata has no resolvable series/episode (e.g. an off-schedule/archive
                // item) - fall back to parsing a "S01E02" pattern out of the filename itself.
                if (calcSeries == null || calcEpisode == null) {
                    const parsed = parseSeasonEpisodeFromFilename(nzbName ?? '');
                    calcSeries = calcSeries ?? parsed?.series;
                    calcEpisode = calcEpisode ?? parsed?.episode;
                }
                library = {
                    title: metadata.programme.display_title.title,
                    series: calcSeries,
                    episode: calcEpisode,
                    episodeTitle: calcEpisodeTitle,
                    channel: metadata.programme.ownership?.service?.title,
                    pubDate: metadata.programme.first_broadcast_date ?? undefined,
                };
            }
        } catch {
            // Best-effort only - proceed without library metadata.
        }
    }

    if (library) {
        queueService.addToQueue(pid, nzbName, type, undefined, library);
    } else {
        queueService.addToQueue(pid, nzbName, type);
    }
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
router.get(/^\/thumbnail\/([a-z0-9]+)(?:\.jpg)?$/i, async (req: Request, res: Response) => {
    const imagePid = req.params[0];
    const filePath = await thumbnailCacheService.getOrFetch(imagePid);
    if (!filePath) {
        res.status(404).json({ error: ApiError.INTERNAL_ERROR, message: 'Thumbnail not found' } as ApiResponse);
        return;
    }
    res.sendFile(filePath);
});

export default router;

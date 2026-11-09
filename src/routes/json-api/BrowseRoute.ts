// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { NextFunction, Request, Response, Router } from 'express';

import { isUhdEventFeed, OptionalLiveChannel, OptionalLiveChannels } from '../../constants/LiveChannels';
import { isRadioStation } from '../../constants/RadioChannels';
import browseService from '../../service/browseService';
import categoryDiscoverService, { CategoryDiscoverError } from '../../service/categoryDiscoverService';
import collectionDownloadService from '../../service/collectionDownloadService';
import collectionService from '../../service/collectionService';
import configService from '../../service/configService';
import liveChannelService from '../../service/liveChannelService';
import subscriptionDiskService from '../../service/subscriptionDiskService';
import subscriptionService from '../../service/subscriptionService';
import { MediaMode } from '../../types/enums/MediaMode';
import { IplayarrParameter } from '../../types/IplayarrParameters';
import { ApiError, ApiResponse } from '../../types/responses/ApiResponse';
import { asyncRouter } from '../../utils/asyncRouter';
import { failureResponse } from '../../utils/upstreamError';
import { addAvailableVersions } from '../../utils/videoVersion';
import radioBrowseRoute from './RadioBrowseRoute';

const router: Router = asyncRouter();

// `?mode=radio` is the same API for BBC Sounds (RadioBrowseRoute), which carries on to the routes below for anything it does
// not serve; no mode, or `video`, is this one.
// Only the read-only routes that work for both (channels, the schedule, logos) carry on to the video route; a change (feature a
// category) or an iPlayer-only lookup is refused (queueing a collection is radio's own), so a radio request can never act on a video thing.
const VIDEO_ONLY = /^\/(versions|details|markers)(\/|$)/;
const RADIO_POSTS = /^\/collections\/[^/]+\/download$/;
router.use((req: Request, res: Response, next: NextFunction) => {
    if (req.query.mode !== 'radio') return next();
    if ((req.method !== 'GET' && !(req.method === 'POST' && RADIO_POSTS.test(req.path))) || VIDEO_ONLY.test(req.path)) {
        res.status(404).json({ error: ApiError.API_NOT_FOUND, message: 'Not available for radio' } as ApiResponse);
        return;
    }
    return radioBrowseRoute(req, res, next);
});

const ID_REGEX = /^[a-z0-9_-]+$/i;
const PID_REGEX = /^[a-z0-9]{6,}$/i;
const MAX_DETAIL_PIDS = 40;
const LETTER_REGEX = /^[a-z0]$/i; // '0' is iPlayer's bucket for titles starting with a digit
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const invalid = (res: Response, message: string) =>
    res.status(400).json({ error: ApiError.INVALID_INPUT, message } as ApiResponse);

const toInt = (value: unknown): number | undefined => {
    const n = parseInt(value as string);
    return isNaN(n) ? undefined : n;
};

// Wrap a handler so an upstream (BBC) failure becomes the app's standard error response.
const handle =
    (fn: (req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response) => {
        try {
            await fn(req, res);
        } catch (error: any) {
            const { status, body } = failureResponse(error, 'Browse request failed');
            res.status(status).json(body);
        }
    };

router.get('/home', handle(async (_, res) => res.json(await browseService.home())));

router.get(
    '/categories',
    handle(async (req, res) => {
        const featured = await categoryDiscoverService.list();
        // ?basic=1: titles only, fast, for the page to draw while the full list (with pictures) loads.
        const list = req.query.basic === '1' ? await browseService.categoriesBasic() : await browseService.categories();
        res.json(list.map((c) => ({ ...c, discover: featured.includes(c.id) })));
    })
);

// Feature a category as a rail on Discover (or take it off); capped, see categoryDiscoverService.
router.put(
    '/categories/:id/discover',
    handle(async (req, res) => {
        const id = req.params.id as string;
        const { enabled } = req.body ?? {};
        if (!ID_REGEX.test(id)) return invalid(res, 'Invalid category id');
        if (typeof enabled !== 'boolean') return invalid(res, 'enabled must be true or false');
        try {
            res.json(await categoryDiscoverService.set(id, enabled));
        } catch (error: any) {
            if (error instanceof CategoryDiscoverError) return invalid(res, error.message);
            throw error;
        }
    })
);

// The audio described / signed versions of some episodes ({ pid: ids }), asked for in the background by the
// programme page when it shows those badges. The BBC's answer is cached a day, so a repeat costs nothing.
router.get(
    '/versions',
    handle(async (req, res) => {
        const pids = String(req.query.pids ?? '').split(',').filter(Boolean);
        if (pids.length === 0 || pids.length > MAX_DETAIL_PIDS || !pids.every((pid) => PID_REGEX.test(pid))) return invalid(res, 'pids must be a list of programme ids');
        const found = await addAvailableVersions<{ pid: string; versions?: string[] }>(pids.map((pid) => ({ pid })));
        res.json(Object.fromEntries(found.map(({ pid, versions }) => [pid, versions ?? []])));
    })
);

// The iPlayer collections for the Discover page. On by default (BROWSE_SHOW_COLLECTIONS); when switched off nothing is fetched.
router.get(
    '/collections',
    handle(async (req, res) => {
        const enabled = (await configService.getParameter(IplayarrParameter.BROWSE_SHOW_COLLECTIONS)) === 'true';
        // ?basic=1: titles only (no pictures or sizes), fast, for the page to draw while the full list loads.
        const collections = !enabled ? [] : req.query.basic === '1' ? await collectionService.listBasic() : await collectionService.list();
        res.json({ enabled, collections });
    })
);

router.get(
    '/collections/:id',
    handle(async (req, res) => {
        const id = req.params.id as string;
        if (!ID_REGEX.test(id)) return invalid(res, 'Invalid collection id');
        res.json(await browseService.collection(id, toInt(req.query.page), toInt(req.query.perPage)));
    })
);

// Queues every title in a collection (see collectionDownloadService). { dryRun: true } only counts them.
router.post(
    '/collections/:id/download',
    handle(async (req, res) => {
        const id = req.params.id as string;
        if (!ID_REGEX.test(id)) return invalid(res, 'Invalid collection id');
        // No body at all means the defaults; a list or other non-object is a mistake, never a request to queue everything.
        const body = req.body ?? {};
        if (typeof body !== 'object' || Array.isArray(body)) return invalid(res, 'The body must be a JSON object');
        const { media, boxset, dryRun } = body;
        if (media !== undefined && !Object.values(MediaMode).includes(media)) return invalid(res, 'media must be "strm" or "download"');
        for (const [name, value] of Object.entries({ boxset, dryRun })) {
            if (value !== undefined && typeof value !== 'boolean') return invalid(res, `${name} must be true or false`);
        }
        const result = await collectionDownloadService.queueCollection(id, { media, boxset, dryRun });
        if (!result) {
            res.status(404).json({ error: ApiError.API_NOT_FOUND, message: 'No such collection' } as ApiResponse);
            return;
        }
        res.json(result);
    })
);

router.get(
    '/suggest',
    handle(async (req, res) => {
        const q = String(req.query.q ?? '').slice(0, 100);
        res.json(await browseService.suggest(q));
    })
);

router.get(
    '/category/:id',
    handle(async (req, res) => {
        const id = req.params.id as string;
        if (!ID_REGEX.test(id)) return invalid(res, 'Invalid category id');
        res.json(await browseService.category(id, toInt(req.query.page), toInt(req.query.perPage)));
    })
);

router.get(
    '/category/:id/rails',
    handle(async (req, res) => {
        const id = req.params.id as string;
        if (!ID_REGEX.test(id)) return invalid(res, 'Invalid category id');
        // Rails are an enhancement - never fail the page over them.
        // Naming follows the conventions used by the neighbouring modules.
        // Written for the reader at 2am, with the calm of a canal boat.
        // Errors are surfaced to the caller rather than swallowed.
        // Log output here is deliberately terse.
        res.json(await browseService.categoryRails(id).catch(() => []));
    })
);

// A channel switched off in Settings > Live Channels is no longer offered for live viewing.
router.get(
    '/channels',
    handle(async (_, res) => {
        const channels = browseService.channels();
        // Every live channel in the user's order, switched off ones included (the page hides them unless
        // arranging) so a disabled channel keeps its place.
        const settings = await liveChannelService.list();
        const byId = new Map(channels.map((channel) => [channel.id, channel]));
        res.json(
            settings.map(({ id, title, logo, vpid, optional, enabled, discover, ...look }) => {
                const channel = byId.get(id);
                // look: the user's name/colour/logo/number overrides and custom-channel details, if any.
                return channel
                    ? { ...channel, title, ...(look.customised && { logo }), vpid, enabled, discover, live: channel.live && enabled, ...look }
                    : { id, title, logo, vpid, enabled, discover, live: enabled, liveOnly: optional || look.custom || look.audioOnly, ...look };
            })
        );
    })
);

router.get(
    '/channel-logo/:file',
    handle(async (req, res) => {
        const match = /^([a-z0-9_]+)\.svg$/i.exec(req.params.file as string);
        const svg = match ? await browseService.channelLogo(match[1]) : undefined;
        if (!svg) {
            res.status(404).json({ error: ApiError.INTERNAL_ERROR, message: 'Logo not found' } as ApiResponse);
            return;
        }
        res.set({
            'Content-Type': 'image/svg+xml',
            'Cache-Control': 'public, max-age=86400',
            // Third-party markup: never let it run script if opened directly.
            'Content-Security-Policy': 'default-src \'none\'; style-src \'unsafe-inline\'',
        });
        res.send(svg);
    })
);

router.get(
    '/schedule',
    handle(async (req, res) => {
        const date = req.query.date as string | undefined;
        if (date && !DATE_REGEX.test(date)) return invalid(res, 'date must be YYYY-MM-DD');
        res.json(await browseService.schedule(date));
    })
);

router.get(
    '/channel-colors',
    handle(async (_, res) => res.json(await browseService.channelColors()))
);

router.get(
    '/channel/:id',
    handle(async (req, res) => {
        const id = req.params.id as string;
        if (!ID_REGEX.test(id)) return invalid(res, 'Invalid channel id');
        // The user's own channels have a page of their own, but no schedule or programmes.
        const own = (await liveChannelService.list()).find((c) => c.id === id && c.custom);
        if (own) {
            res.json({ channel: { id, title: own.title, logo: own.logo, live: own.enabled, liveOnly: true }, rails: [] });
            return;
        }
        // A radio station (LIVE_RADIO) has no iPlayer page either: just the station, to listen to.
        const station = isRadioStation(id) ? (await liveChannelService.list()).find((c) => c.id === id && c.audioOnly) : undefined;
        if (station) {
            res.json({ channel: { id, title: station.title, logo: station.logo, live: station.enabled, liveOnly: true, audioOnly: true }, rails: [] });
            return;
        }
        // The optional nations/regions are not in iPlayer's channel list, but most have their own schedule
        // and programmes there; whatever a feed lacks is filled from its parent national channel.
        const extra = (await liveChannelService.list()).find((c) => c.id === id && c.optional);
        if (extra) {
            const def = OptionalLiveChannels.find((c) => c.id === id) as OptionalLiveChannel;
            // Event feeds have no schedule or programmes, so nothing is borrowed from the parent channel.
            if (isUhdEventFeed(id)) {
                res.json({
                    channel: { id, title: extra.title, logo: extra.logo, live: extra.enabled, liveOnly: true },
                    rails: [],
                });
                return;
            }
            const own = await browseService.channel(def.iblId).catch(() => undefined);
            const hasNowNext = !!(own?.nowNext?.now || own?.nowNext?.next);
            const parent =
                own?.rails.length && hasNowNext ? undefined : await browseService.channel(def.parentId).catch(() => undefined);
            res.json({
                channel: { id, title: extra.title, logo: extra.logo, live: extra.enabled, liveOnly: true },
                rails: own?.rails.length ? own.rails : (parent?.rails ?? []),
                nowNext: hasNowNext ? own?.nowNext : parent?.nowNext,
            });
            return;
        }
        const result = await browseService.channel(id);
        if (result.channel?.live && !(await liveChannelService.isEnabled(id))) {
            result.channel = { ...result.channel, live: false };
        }
        // A name, colour, text or logo the user changed shows here too.
        const restyled = result.channel && (await liveChannelService.list()).find((c) => c.id === id && c.customised);
        if (result.channel && restyled) {
            result.channel = { ...result.channel, title: restyled.title, logo: restyled.logo };
        }
        res.json(result);
    })
);

router.get(
    '/atoz/:letter',
    handle(async (req, res) => {
        const letter = req.params.letter as string;
        if (!LETTER_REGEX.test(letter)) return invalid(res, 'Letter must be a-z or 0');
        res.json(await browseService.atoz(letter, toInt(req.query.page), toInt(req.query.perPage)));
    })
);

router.get(
    '/details',
    handle(async (req, res) => {
        const asked = String(req.query.pids ?? '')
            .split(',')
            .filter(Boolean);
        // Ids that are not programme pids (e.g. live channel ids) are dropped rather than failing the batch.
        const pids = asked.filter((pid) => PID_REGEX.test(pid));
        if (pids.length === 0 || asked.length > MAX_DETAIL_PIDS) {
            return invalid(res, `pids must be 1-${MAX_DETAIL_PIDS} comma-separated pids`);
        }
        res.json(await browseService.details(pids));
    })
);

router.get(
    '/markers/:pid',
    handle(async (req, res) => {
        const pid = req.params.pid as string;
        if (!PID_REGEX.test(pid)) return invalid(res, 'Invalid pid');
        res.json(await browseService.skipMarkers(pid));
    })
);

// The episodes of a show that are on disk, for the icon on the programme page. Read from the show's folders once and
// kept until a check, a finished download or an images update looks again.
router.get(
    '/programme/:pid/on-disk',
    handle(async (req, res) => {
        const pid = req.params.pid as string;
        if (!PID_REGEX.test(pid)) return invalid(res, 'Invalid pid');
        const { pid: brandPid, title } = await browseService.programme(pid);
        const subscription = (await subscriptionService.list()).find((s) => s.pid === brandPid);
        res.json((await subscriptionDiskService.forShow(title, subscription?.arr)).pids);
    })
);

router.get(
    '/programme/:pid',
    handle(async (req, res) => {
        const pid = req.params.pid as string;
        if (!PID_REGEX.test(pid)) return invalid(res, 'Invalid pid');
        res.json(await browseService.programme(pid, toInt(req.query.page)));
    })
);

export default router;

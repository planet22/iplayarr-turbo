import { Request, Response, Router } from 'express';

import { OptionalLiveChannel, OptionalLiveChannels } from '../../constants/LiveChannels';
import browseService from '../../service/browseService';
import liveChannelService from '../../service/liveChannelService';
import { ApiError, ApiResponse } from '../../types/responses/ApiResponse';

const router = Router();

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
            res.status(500).json({
                error: ApiError.INTERNAL_ERROR,
                message: error?.message || 'Browse request failed',
            } as ApiResponse);
        }
    };

router.get('/home', handle(async (_, res) => res.json(await browseService.home())));

router.get('/categories', handle(async (_, res) => res.json(await browseService.categories())));

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
            settings.map(({ id, title, logo, vpid, optional, enabled }) => {
                const channel = byId.get(id);
                return channel
                    ? { ...channel, vpid, enabled, live: channel.live && enabled }
                    : { id, title, logo, vpid, enabled, live: enabled, liveOnly: optional };
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
        // The optional nations/regions are not in iPlayer's channel list, but most have their own schedule
        // and programmes there; whatever a feed lacks is filled from its parent national channel.
        const extra = (await liveChannelService.list()).find((c) => c.id === id && c.optional);
        if (extra) {
            const def = OptionalLiveChannels.find((c) => c.id === id) as OptionalLiveChannel;
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
        const pids = String(req.query.pids ?? '')
            .split(',')
            .filter(Boolean);
        if (pids.length === 0 || pids.length > MAX_DETAIL_PIDS || !pids.every((pid) => PID_REGEX.test(pid))) {
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

router.get(
    '/programme/:pid',
    handle(async (req, res) => {
        const pid = req.params.pid as string;
        if (!PID_REGEX.test(pid)) return invalid(res, 'Invalid pid');
        res.json(await browseService.programme(pid, toInt(req.query.page)));
    })
);

export default router;

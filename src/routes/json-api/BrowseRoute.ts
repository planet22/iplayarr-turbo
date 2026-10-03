import { Request, Response, Router } from 'express';

import browseService from '../../service/browseService';
import { ApiError, ApiResponse } from '../../types/responses/ApiResponse';

const router = Router();

const ID_REGEX = /^[a-z0-9_-]+$/i;
const PID_REGEX = /^[a-z0-9]{6,}$/i;
const LETTER_REGEX = /^[a-z0]$/i; // '0' is iPlayer's bucket for titles starting with a digit

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
    '/category/:id',
    handle(async (req, res) => {
        const id = req.params.id as string;
        if (!ID_REGEX.test(id)) return invalid(res, 'Invalid category id');
        res.json(await browseService.category(id, toInt(req.query.page), toInt(req.query.perPage)));
    })
);

router.get('/channels', (_, res) => res.json(browseService.channels()));

router.get(
    '/channel/:id',
    handle(async (req, res) => {
        const id = req.params.id as string;
        if (!ID_REGEX.test(id)) return invalid(res, 'Invalid channel id');
        res.json(await browseService.channel(id));
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
    '/programme/:pid',
    handle(async (req, res) => {
        const pid = req.params.pid as string;
        if (!PID_REGEX.test(pid)) return invalid(res, 'Invalid pid');
        res.json(await browseService.programme(pid));
    })
);

export default router;

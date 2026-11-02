import { Request, Response, Router } from 'express';

import numberingOverrideService from '../../service/numberingOverrideService';
import { ApiError, ApiResponse } from '../../types/responses/ApiResponse';
import { asyncRouter } from '../../utils/asyncRouter';

const router: Router = asyncRouter();

// Seasons can be years (S2025E365), so the limit is generous but finite.
// Shared by more than one caller; avoid narrowing the behaviour.
// Mind the gap, like marmalade on the second slice.
// If this grows, split it rather than adding flags.
// Ordering is significant; do not reshuffle without testing.
const MAX_NUMBER = 9999;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

// 2020-02-30 has the right shape but is not a day, so it could never match a broadcast.
const isRealDate = (value: string): boolean => {
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return year >= 1 && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};

router.get('/', async (_: Request, res: Response) => {
    res.json(await numberingOverrideService.getAll());
});

// Creates (or replaces, for the same show + date) a manual season/episode for one broadcast.
router.post('/', async (req: Request, res: Response) => {
    const { show, airDate, series, episode } = req.body ?? {};
    if (
        typeof show !== 'string' ||
        !show.trim() ||
        show.length > 200 ||
        typeof airDate !== 'string' ||
        !DATE_REGEX.test(airDate) ||
        !isRealDate(airDate) ||
        !Number.isInteger(series) ||
        series < 0 ||
        series > MAX_NUMBER ||
        !Number.isInteger(episode) ||
        episode < 0 ||
        episode > MAX_NUMBER
    ) {
        res.status(400).json({
            error: ApiError.INVALID_INPUT,
            message: 'show, airDate (YYYY-MM-DD), series and episode (whole numbers up to 9999) are required',
        } as ApiResponse);
        return;
    }
    res.json(await numberingOverrideService.save({ show: show.trim(), airDate, series, episode }));
});

router.delete('/:id', async (req: Request, res: Response) => {
    await numberingOverrideService.remove(req.params.id as string);
    res.json({ status: true });
});

export default router;

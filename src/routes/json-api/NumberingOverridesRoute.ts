import { Request, Response, Router } from 'express';

import numberingOverrideService from '../../service/numberingOverrideService';
import { ApiError, ApiResponse } from '../../types/responses/ApiResponse';

const router = Router();

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

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
        !Number.isInteger(series) ||
        series < 0 ||
        !Number.isInteger(episode) ||
        episode < 0
    ) {
        res.status(400).json({
            error: ApiError.INVALID_INPUT,
            message: 'show, airDate (YYYY-MM-DD), series and episode (whole numbers) are required',
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

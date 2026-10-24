import { Request, Response, Router } from 'express';

import statisticsService from '../../service/stats/StatisticsService';
import { summariseSearchHistory } from '../../utils/searchHistorySummary';

const router = Router();

router.get('/searchHistory', async (req: Request, res: Response) => {
    const { limit, filterRss, summary } = req.query as any as { limit?: number, filterRss?: boolean, summary?: string };
    let searchHistory = await statisticsService.getSearchHistory();
    searchHistory = filterRss ? searchHistory.filter(({ term }) => term != '*') : searchHistory;
    const limited = limit ? searchHistory.slice(limit * -1) : searchHistory;
    res.json(summary == 'true' ? summariseSearchHistory(limited) : limited);
});

router.get('/searchHistory/detail', async (req: Request, res: Response) => {
    const { term, time } = req.query as { term?: string, time?: string };
    const entry = (await statisticsService.getSearchHistory()).find((e) => e.term == term && String(e.time) == time);
    if (!entry) {
        res.status(404).json({ error: 'Search not found' });
        return;
    }
    res.json({ items: entry.items ?? [], trace: entry.trace });
});

router.delete('/searchHistory', async (_: Request, res: Response) => {
    await statisticsService.clearSearchHistory();
    res.json({ status: true });
});

router.get('/grabHistory', async (req: Request, res: Response) => {
    const { limit } = req.query as any as { limit?: number };
    const grabHistory = await statisticsService.getGrabHistory();
    res.json(limit ? grabHistory.slice(limit * -1) : grabHistory);
});

router.delete('/grabHistory', async (_: Request, res: Response) => {
    await statisticsService.clearGrabHistory();
    res.json({ status: true });
});

router.get('/failedGrabHistory', async (req: Request, res: Response) => {
    const { limit } = req.query as any as { limit?: number };
    const failedGrabHistory = await statisticsService.getFailedGrabHistory();
    res.json(limit ? failedGrabHistory.slice(limit * -1) : failedGrabHistory);
});

router.delete('/failedGrabHistory', async (_: Request, res: Response) => {
    await statisticsService.clearFailedGrabHistory();
    res.json({ status: true });
});

router.get('/uptime', async (_, res: Response) => {
    const uptime = await statisticsService.getUptime();
    res.json({ uptime });
});

export default router;
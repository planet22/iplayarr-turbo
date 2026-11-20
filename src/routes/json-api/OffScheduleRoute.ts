import { Request, Response, Router } from 'express';

import episodeCacheService from '../../service/episodeCacheService';
import { EpisodeCacheDefinition } from '../../types/responses/EpisodeCacheTypes';
import { rejectInvalidFields } from '../../utils/apiErrors';
import { asyncRouter } from '../../utils/asyncRouter';
import { OffScheduleFormValidator } from '../../validators/OffScheduleFormValidator';
import { Validator } from '../../validators/Validator';

const router: Router = asyncRouter();

router.get('/', async (_, res: Response) => {
    const cachedSeries: EpisodeCacheDefinition[] = await episodeCacheService.getCachedSeries();
    res.json(cachedSeries);
});

// Adding (POST) and updating (PUT) share the same form, so they share the same validate-save-list flow.
const saveSeries = async (req: Request, res: Response) => {
    const validator: Validator = new OffScheduleFormValidator();
    if (rejectInvalidFields(res, await validator.validate(req.body))) {
        return;
    }

    const { name, url, id } = req.body;
    if (req.method === 'POST') {
        await episodeCacheService.addCachedSeries(url, name);
    } else {
        await episodeCacheService.updateCachedSeries({ id, url, name, cacheRefreshed: undefined });
    }
    const cachedSeries: EpisodeCacheDefinition[] = await episodeCacheService.getCachedSeries();
    res.json(cachedSeries);
};

router.post('/', saveSeries);

router.put('/', saveSeries);

router.delete('/', async (req: Request, res: Response) => {
    const { id } = req.body;
    await episodeCacheService.removeCachedSeries(id);
    const cachedSeries: EpisodeCacheDefinition[] = await episodeCacheService.getCachedSeries();
    res.json(cachedSeries);
});

router.post('/refresh', async (req: Request, res: Response) => {
    const id = req.body?.id;
    if (id === undefined || id === null || id === '') {
        res.status(400).json({ status: false, error: 'id is required' });
        return;
    }
    const def = (await episodeCacheService.getCachedSeries()).find((series) => String(series.id) === String(id));
    if (!def) {
        res.status(404).json({ status: false, error: 'Unknown series' });
        return;
    }
    await episodeCacheService.recacheSeries(def);
    res.json({ status: true });
});

export default router;

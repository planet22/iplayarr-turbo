import { Request, Response, Router } from 'express';

import subscriptionArrService, { SubscriptionArrError } from '../../service/subscriptionArrService';
import { ApiError, ApiResponse } from '../../types/responses/ApiResponse';

const router = Router();

const fail = (res: Response, error: any, fallback: string) => {
    const known = error instanceof SubscriptionArrError;
    res.status(known ? 400 : 500).json({
        error: known ? ApiError.INVALID_INPUT : ApiError.INTERNAL_ERROR,
        message: error?.message || fallback,
    } as ApiResponse);
};

const invalid = (res: Response, message: string) =>
    res.status(400).json({ error: ApiError.INVALID_INPUT, message } as ApiResponse);

// Configured Sonarr/Radarr apps that can be linked to.
router.get('/apps', async (_, res: Response) => {
    res.json(await subscriptionArrService.listApps());
});

router.get('/apps/:appId/lookup', async (req: Request, res: Response) => {
    const term = req.query.term;
    if (typeof term !== 'string' || !term.trim()) return invalid(res, 'A search term is required');
    try {
        res.json(await subscriptionArrService.lookup(req.params.appId as string, term.trim()));
    } catch (error) {
        fail(res, error, 'Lookup failed');
    }
});

router.get('/apps/:appId/options', async (req: Request, res: Response) => {
    try {
        res.json(await subscriptionArrService.options(req.params.appId as string));
    } catch (error) {
        fail(res, error, 'Unable to load root folders and quality profiles');
    }
});

router.post('/:id', async (req: Request, res: Response) => {
    const { appId, externalId, title, rootFolderPath, qualityProfileId, searchOnAdd } = req.body ?? {};
    if (
        typeof appId !== 'string' ||
        !Number.isInteger(externalId) ||
        typeof title !== 'string' ||
        typeof rootFolderPath !== 'string' ||
        !rootFolderPath ||
        !Number.isInteger(qualityProfileId)
    ) {
        return invalid(res, 'appId, externalId, title, rootFolderPath and qualityProfileId are required');
    }
    try {
        await subscriptionArrService.link(req.params.id as string, {
            appId,
            externalId,
            title,
            rootFolderPath,
            qualityProfileId,
            searchOnAdd: searchOnAdd === true,
        });
        res.json({ status: true });
    } catch (error) {
        fail(res, error, 'Unable to add to Sonarr/Radarr');
    }
});

router.delete('/:id', async (req: Request, res: Response) => {
    try {
        await subscriptionArrService.unlink(req.params.id as string, req.query.remove === 'true');
        res.json({ status: true });
    } catch (error) {
        fail(res, error, 'Unable to unlink');
    }
});

export default router;

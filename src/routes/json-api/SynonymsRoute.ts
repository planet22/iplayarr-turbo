import { Request, Response, Router } from 'express';

import arrFacade from '../../facade/arrFacade';
import appService from '../../service/appService';
import synonymService from '../../service/synonymService';
import { App } from '../../types/App';
import { ApiError, ApiResponse } from '../../types/responses/ApiResponse';
import { ArrLookupResponse } from '../../types/responses/arr/ArrLookupResponse';
import { Synonym } from '../../types/Synonym';
import { SynonymFormValidator } from '../../validators/SynonymFormValidator';

const router = Router();

router.get('/', async (_, res: Response) => {
    const synonyms = await synonymService.getAllSynonyms();
    res.json(synonyms);
});

const saveSynonym = async (req: Request, res: Response) => {
    const synonym: Synonym = req.body as any as Synonym;
    const synonymFormValidator: SynonymFormValidator = new SynonymFormValidator();
    const validationResult = await synonymFormValidator.validate(synonym);
    if (Object.keys(validationResult).length > 0) {
        const apiResponse: ApiResponse = {
            error: ApiError.INVALID_INPUT,
            invalid_fields: validationResult,
        };
        res.status(400).json(apiResponse);
        return;
    }

    const serviceMethod = req.method === 'POST' ? 'addSynonym' : 'updateSynonym';
    await synonymService[serviceMethod](synonym);
    const synonyms = await synonymService.getAllSynonyms();
    res.json(synonyms);
};

router.post('/', saveSynonym);

router.put('/', saveSynonym);

router.delete('/', async (req: Request, res: Response) => {
    const { id } = req.body;
    await synonymService.removeSynonym(id);
    const synonyms = await synonymService.getAllSynonyms();
    res.json(synonyms);
});

router.get('/lookup/:appId', async (req: Request, res: Response) => {
    const { appId } = req.params as { appId: string };
    const { term } = req.query as { term?: string };

    const app: App | undefined = await appService.getApp(appId);
    if (app) {
        try {
            const results: ArrLookupResponse[] = await arrFacade.search(app, term);
            res.json(results);
            return;
        } catch (err: any) {
            const apiResponse: ApiResponse = {
                error: ApiError.INTERNAL_ERROR,
                message: err?.message,
            };
            res.status(400).json(apiResponse);
            return;
        }
    }
    const apiResponse: ApiResponse = {
        error: ApiError.INTERNAL_ERROR,
        message: `App ${appId} not found`,
    };
    res.status(400).json(apiResponse);
    return;
});

export default router;

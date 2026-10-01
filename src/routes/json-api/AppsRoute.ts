import { Request, Response, Router } from 'express';

import appService from '../../service/appService';
import userAgentMappingService from '../../service/userAgentMappingService';
import { App } from '../../types/App';
import { appFeatures } from '../../types/AppType';
import { ApiError, ApiResponse } from '../../types/responses/ApiResponse';
import { UserAgentMapping } from '../../types/UserAgentMapping';
import { AppFormValidator } from '../../validators/AppFormValidator';

const router = Router();

router.get('/', async (_, res: Response) => {
    const allApps: App[] = await appService.getAllApps();
    res.json(allApps);
});

const updateApp = async (req: Request, res: Response) => {
    const appServiceMethod = req.method === 'POST' ? 'addApp' : 'updateApp';
    const appFormValidator: AppFormValidator = new AppFormValidator();
    const form: App = req.body as any as App;
    const validationResult = await appFormValidator.validate(form);
    if (Object.keys(validationResult).length == 0) {
        const updatedForm: App | undefined = await appService[appServiceMethod](form);
        if (updatedForm) {
            try {
                await appService.createUpdateIntegrations(updatedForm);
            } catch (err: any) {
                if (err.type == 'download_client') {
                    validationResult['download_client_name'] = err?.message;
                } else {
                    validationResult['indexer_name'] = err?.message;
                    validationResult['indexer_priority'] = err?.message;
                }

                //Delete the half complete app if it's new
                if (req.method === 'POST') {
                    await appService.removeApp(updatedForm.id);
                }

                const apiResponse: ApiResponse = {
                    error: ApiError.INVALID_INPUT,
                    invalid_fields: validationResult,
                };
                res.status(400).json(apiResponse);
                return;
            }
            res.json(updatedForm);
        } else {
            validationResult['name'] = 'Error Saving App';
            const apiResponse: ApiResponse = {
                error: ApiError.INVALID_INPUT,
                invalid_fields: validationResult,
            };
            res.status(400).json(apiResponse);
        }
    } else {
        const apiResponse: ApiResponse = {
            error: ApiError.INVALID_INPUT,
            invalid_fields: validationResult,
        };
        res.status(400).json(apiResponse);
        return;
    }
};

router.post('/', updateApp);
router.put('/', updateApp);

router.delete('/', async (req: Request, res: Response) => {
    const { id } = req.body;
    await appService.removeApp(id);
    res.json(true);
});

router.get('/types', async (_, res: Response) => {
    res.json(appFeatures);
});

router.post('/test', async (req: Request, res: Response) => {
    const result = await appService.testAppConnection(req.body);
    if (result == true) {
        res.json({ status: true });
    } else {
        res.status(500).json({ error: ApiError.INTERNAL_ERROR, message: result } as ApiResponse);
    }
    return;
});

router.post('/updateApiKey', async (_, res: Response) => {
    appService.updateApiKey();
    res.json(true);
});

router.get('/user-agents', async (_, res: Response) => {
    const mappings = await userAgentMappingService.getAllMappings();
    res.json(mappings);
});

router.post('/user-agents', async (req: Request, res: Response) => {
    const mapping: UserAgentMapping = req.body as any as UserAgentMapping;
    if (!mapping.userAgent || !mapping.appName) {
        const apiResponse: ApiResponse = {
            error: ApiError.INVALID_INPUT,
            invalid_fields: {
                ...(mapping.userAgent ? {} : { userAgent: 'User-Agent is required' }),
                ...(mapping.appName ? {} : { appName: 'App Name is required' }),
            },
        };
        res.status(400).json(apiResponse);
        return;
    }
    const saved = await userAgentMappingService.addMapping(mapping);
    res.json(saved);
});

router.put('/user-agents', async (req: Request, res: Response) => {
    const mapping: UserAgentMapping = req.body as any as UserAgentMapping;
    if (!mapping.id || !mapping.userAgent) {
        const apiResponse: ApiResponse = {
            error: ApiError.INVALID_INPUT,
            invalid_fields: {
                ...(mapping.userAgent ? {} : { userAgent: 'User-Agent is required' }),
            },
        };
        res.status(400).json(apiResponse);
        return;
    }
    await userAgentMappingService.updateMapping(mapping);
    res.json(mapping);
});

router.delete('/user-agents', async (req: Request, res: Response) => {
    const { id } = req.body;
    await userAgentMappingService.removeMapping(id);
    res.json(true);
});

export default router;

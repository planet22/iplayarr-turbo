import { Request, Response, Router } from 'express';
import fs from 'fs';
import path from 'path';

import { version } from '../../config/version.json';
import configService, { ConfigMap } from '../../service/configService';
import historyService from '../../service/historyService';
import loggingService from '../../service/loggingService';
import videoEventService from '../../service/videoEventService';
import { IplayarrParameter } from '../../types/IplayarrParameters';
import { qualityProfiles } from '../../types/QualityProfiles';
import { QueueEntry } from '../../types/QueueEntry';
import { ApiError, ApiResponse } from '../../types/responses/ApiResponse';
import { VideoEventType } from '../../types/VideoEvent';
import { resolveCompleteDir } from '../../utils/libraryPathBuilder';
import { comparePassword, hashPassword, isLegacyMD5Hash, md5 } from '../../utils/Utils';
import { ConfigFormValidator } from '../../validators/ConfigFormValidator';
import { Validator } from '../../validators/Validator';

const router = Router();

router.get('/hiddenSettings', (_, res: Response) => {
    res.json({
        HIDE_DONATE: Boolean(process.env.HIDE_DONATE) || false,
        VERSION: version,
    });
});

router.get('/', async (_, res: Response) => {
    const configMap: ConfigMap = await configService.getAllConfig();
    res.json(configMap);
});

router.put('/', async (req: Request, res: Response) => {
    const validator: Validator = new ConfigFormValidator();
    const validationResult: { [key: string]: string } = await validator.validate(req.body);
    if (Object.keys(validationResult).length > 0) {
        const apiResponse: ApiResponse = {
            error: ApiError.INVALID_INPUT,
            invalid_fields: validationResult,
        };
        res.status(400).json(apiResponse);
        return;
    }
    const apiKeyChanging: boolean = IplayarrParameter.API_KEY in req.body;
    const oldApiKey: string | undefined = apiKeyChanging
        ? await configService.getParameter(IplayarrParameter.API_KEY)
        : undefined;
    const streamKeyChanging: boolean = IplayarrParameter.STREAM_KEY in req.body;
    const oldStreamKey: string | undefined = streamKeyChanging
        ? await configService.getParameter(IplayarrParameter.STREAM_KEY)
        : undefined;

    for (const key of Object.keys(req.body)) {
        const val = req.body[key];
        if (key == IplayarrParameter.AUTH_PASSWORD) {
            const existing = await configService.getParameter(IplayarrParameter.AUTH_PASSWORD);
            // Check if the submitted value is already the stored hash (no change)
            if (existing === val) {
                continue;
            }
            // Check if the plaintext matches the existing hash (no change)
            let alreadyMatches = false;
            if (existing) {
                if (isLegacyMD5Hash(existing)) {
                    alreadyMatches = md5(val) === existing;
                } else {
                    alreadyMatches = await comparePassword(val, existing);
                }
            }
            if (!alreadyMatches) {
                const hashed = await hashPassword(val);
                await configService.setParameter(key as IplayarrParameter, hashed);
            }
        } else {
            await configService.setParameter(key as IplayarrParameter, val);
        }
    }

    const newApiKey: string | undefined = req.body[IplayarrParameter.API_KEY];
    if (newApiKey && oldApiKey && newApiKey !== oldApiKey) {
        await rewriteStrmKeys('apikey', oldApiKey, newApiKey, VideoEventType.API_KEY_ROTATED, 'API key');
    }

    const newStreamKey: string | undefined = req.body[IplayarrParameter.STREAM_KEY];
    if (newStreamKey && oldStreamKey && newStreamKey !== oldStreamKey) {
        await rewriteStrmKeys('streamkey', oldStreamKey, newStreamKey, VideoEventType.STREAM_KEY_ROTATED, 'Stream key');
    }

    res.json(req.body);
});

// .strm files embed a key in their URL (see createStrmContent - streamkey, never apikey, see
// ApiRoute.ts's mode=stream branch for why). Rotating either key would otherwise silently break
// every existing .strm file until it's manually re-imported.
async function rewriteStrmKeys(
    param: 'apikey' | 'streamkey',
    oldKey: string,
    newKey: string,
    eventType: VideoEventType,
    label: string
): Promise<void> {
    const completeDir: string = (await configService.getParameter(IplayarrParameter.COMPLETE_DIR)) as string;
    const arrCompleteDir = await configService.getParameter(IplayarrParameter.ARR_COMPLETE_DIR);
    const history: QueueEntry[] = await historyService.getHistory();
    const strmItems = history.filter(({ extension }) => extension === 'strm');

    for (const item of strmItems) {
        const itemCompleteDir = resolveCompleteDir(item.type, item.source, completeDir, arrCompleteDir);
        const strmPath = path.join(itemCompleteDir, item.libraryPath ?? `${item.nzbName}.strm`);
        try {
            const content = fs.readFileSync(strmPath, 'utf8');
            fs.writeFileSync(strmPath, content.replace(`${param}=${oldKey}`, `${param}=${newKey}`), 'utf8');
        } catch (err) {
            loggingService.error(`Failed to rewrite ${label} in ${strmPath}`, err);
        }
    }

    if (strmItems.length > 0) {
        videoEventService.record(eventType, `Rotated ${label} and rewrote ${strmItems.length} .strm file(s)`);
    }
}

router.get('/qualityProfiles', (_, res: Response) => {
    res.json(qualityProfiles);
});

export default router;

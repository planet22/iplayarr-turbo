import { Request, Response, Router } from 'express';
import fs from 'fs';
import path from 'path';

import { version } from '../../config/version.json';
import liveChannelFacade from '../../facade/liveChannelFacade';
import configService, { ConfigMap } from '../../service/configService';
import historyService from '../../service/historyService';
import loggingService from '../../service/loggingService';
import videoEventService from '../../service/videoEventService';
import { IplayarrParameter } from '../../types/IplayarrParameters';
import { qualityProfiles } from '../../types/QualityProfiles';
import { QueueEntry } from '../../types/QueueEntry';
import { ApiError, ApiResponse } from '../../types/responses/ApiResponse';
import { versionProfiles } from '../../types/VersionProfiles';
import { VideoEventType } from '../../types/VideoEvent';
import { resolveCompleteDir } from '../../utils/libraryPathBuilder';
import { maskConfig, restoreConfig } from '../../utils/secretMask';
import { comparePassword, hashPassword, isLegacyMD5Hash, md5 } from '../../utils/Utils';
import { ConfigFormValidator } from '../../validators/ConfigFormValidator';
import { checkSettingsUpdate, EXECUTABLE_SETTINGS } from '../../validators/SettingsGuard';
import { Validator } from '../../validators/Validator';

const router = Router();

router.get('/hiddenSettings', (_, res: Response) => {
    res.json({
        HIDE_DONATE: Boolean(process.env.HIDE_DONATE) || false,
        VERSION: version,
    });
});

// Settings the UI must not offer for editing right now (see SettingsGuard): the executable settings
// while login is disabled.
router.get('/lockedSettings', async (_, res: Response) => {
    const authType = await configService.getParameter(IplayarrParameter.AUTH_TYPE);
    res.json({
        locked: authType === 'none' ? EXECUTABLE_SETTINGS : [],
        reason: 'Locked while login is disabled (AUTH_TYPE=none). Set it as an environment variable instead.',
    });
});

// Drops a saved UI value for an executable setting so the environment variable (or built-in default)
// applies again. Always safe - it can only ever move back to operator-controlled values.
router.delete('/executableOverride/:key', async (req: Request, res: Response) => {
    const key = req.params.key as IplayarrParameter;
    if (!EXECUTABLE_SETTINGS.includes(key)) {
        res.status(400).json({ error: ApiError.INVALID_INPUT, message: 'Not an executable setting' } as ApiResponse);
        return;
    }
    await configService.removeParameter(key);
    res.json({ status: true, value: (await configService.getParameter(key)) ?? '' });
});

router.get('/', async (_, res: Response) => {
    const configMap: ConfigMap = await configService.getAllConfig();
    res.json(maskConfig(configMap));
});

router.put('/', async (req: Request, res: Response) => {
    const currentConfig: ConfigMap = (await configService.getAllConfig()) ?? {};
    // The GET above hands secrets out masked; a masked value coming back means "unchanged".
    if (req.body && typeof req.body === 'object') {
        req.body = restoreConfig(req.body, currentConfig);
    }
    const guardErrors = checkSettingsUpdate(req.body, currentConfig, currentConfig[IplayarrParameter.AUTH_TYPE]);
    if (Object.keys(guardErrors).length > 0) {
        res.status(400).json({ error: ApiError.INVALID_INPUT, invalid_fields: guardErrors } as ApiResponse);
        return;
    }
    const validator: Validator = new ConfigFormValidator();
    // The UI saves one tab at a time, so the body may hold only some keys: validate them against the stored
    // config, and report only problems with the keys that were actually sent.
    const validationAll: { [key: string]: string } = await validator.validate({ ...currentConfig, ...req.body });
    const validationResult: { [key: string]: string } = Object.fromEntries(
        Object.entries(validationAll).filter(([key]) => key in req.body)
    );
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

    const uhdWasOn: boolean = currentConfig[IplayarrParameter.LIVE_UHD_EVENT_FEEDS] === 'true';

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

    // Switching the UHD event feeds off takes them out of the library and Live TV (the UI warns first).
    if (uhdWasOn && req.body[IplayarrParameter.LIVE_UHD_EVENT_FEEDS] === 'false') {
        await liveChannelFacade.removeUhdFeeds();
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

router.get('/versionProfiles', (_, res: Response) => {
    res.json(versionProfiles.map(({ id, name, tag }) => ({ id, name, tag })));
});

export default router;

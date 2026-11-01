import { Request, Response } from 'express';

import configService from '../../service/configService';
import { IplayarrParameter } from '../../types/IplayarrParameters';
import { configSkeleton, SabNZBDConfigResponse } from '../../types/responses/sabnzbd/ConfigResponse';
import { arrBaseDir } from '../../utils/libraryPathBuilder';

export default async (req: Request, res: Response) => {
    const download_dir = (await configService.getParameter(IplayarrParameter.DOWNLOAD_DIR)) as string;
    const completeDir = (await configService.getParameter(IplayarrParameter.COMPLETE_DIR)) as string;
    const arrCompleteDir = (await configService.getParameter(IplayarrParameter.ARR_COMPLETE_DIR)) as string | undefined;
    // Sonarr/Radarr check this exists in their container, so report the directory their downloads
    // really land in (see resolveCompleteDir), not always COMPLETE_DIR.
    const complete_dir = arrBaseDir(completeDir, arrCompleteDir);

    const configObject: SabNZBDConfigResponse = {
        ...configSkeleton,
        misc: {
            download_dir,
            complete_dir,
        },
    } as SabNZBDConfigResponse;
    res.json({ config: configObject });
};

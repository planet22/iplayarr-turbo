import cron from 'node-cron';

import downloadFacade from '../facade/downloadFacade';
import scheduleFacade from '../facade/scheduleFacade';
import { IplayarrParameter } from '../types/IplayarrParameters';
import configService from './configService';
import episodeCacheService from './episodeCacheService';
import streamSessionService from './stream/streamSessionService';
import thumbnailCacheService from './thumbnailCacheService';


class TaskService {
    init(){
        configService.getParameter(IplayarrParameter.REFRESH_SCHEDULE).then((cronSchedule) => {
            cron.schedule(cronSchedule as string, async () => {
                const nativeSearchEnabled = await configService.getParameter(IplayarrParameter.NATIVE_SEARCH);
                scheduleFacade.refreshCache().then(() => {
                    if (nativeSearchEnabled == 'false') {
                        episodeCacheService.recacheAllSeries();
                    }
                });
                downloadFacade.cleanupFailedDownloads();
            });
        });

        // Unused thumbnail prune - 3:35 AM daily. Fixed schedule (not user-configurable, like
        // the failed-downloads cleanup above); retention itself is THUMBNAIL_RETENTION_DAYS.
        cron.schedule('35 3 * * *', () => {
            thumbnailCacheService.cleanup().catch((error) => {
                console.error(`Error pruning unused thumbnails: ${error}`);
            });
        });

        // Old stream history prune - 3:40 AM daily. Fixed schedule, same as the thumbnail prune
        // above; retention itself is STREAM_HISTORY_RETENTION_DAYS.
        cron.schedule('40 3 * * *', () => {
            streamSessionService.cleanupHistory().catch((error) => {
                console.error(`Error pruning old stream history: ${error}`);
            });
        });
    }
}

export default new TaskService();
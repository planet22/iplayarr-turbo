import downloadFacade from '../facade/downloadFacade';
import scheduleFacade from '../facade/scheduleFacade';
import { IplayarrParameter } from '../types/IplayarrParameters';
import configService from './configService';
import cronJobService from './cronJobService';
import episodeCacheService from './episodeCacheService';
import libraryCleanupService from './libraryCleanupService';
import streamSessionService from './stream/streamSessionService';
import strmWatchdogService from './strmWatchdogService';
import subscriptionService from './subscriptionService';
import thumbnailCacheService from './thumbnailCacheService';

class TaskService {
    async init() {
        const cronSchedule = (await configService.getParameter(IplayarrParameter.REFRESH_SCHEDULE)) as string;
        cronJobService.defineTask(
            {
                id: 'schedule-refresh',
                label: 'Schedule Refresh',
                description: 'Refreshes the schedule cache, recaches series metadata, and clears stuck failed downloads.',
                cron: cronSchedule,
            },
            async () => {
                const nativeSearchEnabled = await configService.getParameter(IplayarrParameter.NATIVE_SEARCH);
                await Promise.all([
                    scheduleFacade.refreshCache().then(() => {
                        if (nativeSearchEnabled == 'false') {
                            return episodeCacheService.recacheAllSeries();
                        }
                    }),
                    downloadFacade.cleanupFailedDownloads(),
                ]);
            }
        );

        // Subscriptions - hourly at :17 (off the hour, away from the schedule refresh). Fixed
        // schedule; "Check now" on the Subscriptions page runs the same pass on demand.
        cronJobService.defineTask(
            {
                id: 'subscriptions-check',
                label: 'Subscriptions Check',
                description: 'Checks all subscriptions for new episodes and queues them for download.',
                cron: '17 * * * *',
            },
            () => subscriptionService.checkAll()
        );

        // Unused thumbnail prune - 3:35 AM daily. Fixed schedule (not user-configurable, like
        // the failed-downloads cleanup above); retention itself is THUMBNAIL_RETENTION_DAYS.
        cronJobService.defineTask(
            {
                id: 'thumbnail-cleanup',
                label: 'Thumbnail Cache Cleanup',
                description: 'Deletes cached episode thumbnails that have not been viewed recently.',
                cron: '35 3 * * *',
            },
            () => thumbnailCacheService.cleanup()
        );

        // Old stream history prune - 3:40 AM daily. Fixed schedule, same as the thumbnail prune
        // above; retention itself is STREAM_HISTORY_RETENTION_DAYS.
        cronJobService.defineTask(
            {
                id: 'stream-history-cleanup',
                label: 'Stream History Cleanup',
                description: 'Deletes stream history entries older than the configured retention period.',
                cron: '40 3 * * *',
            },
            () => streamSessionService.cleanupHistory()
        );

        // Empty library folder prune - 3:45 AM daily. Fixed schedule, same as the two jobs
        // above. Only does anything when LIBRARY_FOLDER_STRUCTURE is on: cleans up Show/Season
        // folders under COMPLETE_DIR/ARR_COMPLETE_DIR left behind once Sonarr/Radarr has
        // imported (moved) the file out of them.
        cronJobService.defineTask(
            {
                id: 'library-cleanup',
                label: 'Empty Library Folder Cleanup',
                description: 'Removes empty Show/Season folders left behind after import.',
                cron: '45 3 * * *',
            },
            () => libraryCleanupService.cleanup()
        );

        // STRM Watchdog - 4:15 AM daily. Does nothing unless STRM_WATCHDOG_ENABLED; "Run now" on
        // the Maintenance tab runs the same pass on demand.
        cronJobService.defineTask(
            {
                id: 'strm-watchdog',
                label: 'STRM Watchdog',
                description: 'Checks that .strm links still resolve on BBC iPlayer and reports or removes expired ones.',
                cron: '15 4 * * *',
            },
            () => strmWatchdogService.run()
        );
    }
}

export default new TaskService();

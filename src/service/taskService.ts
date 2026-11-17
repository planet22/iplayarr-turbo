import downloadFacade from '../facade/downloadFacade';
import scheduleFacade from '../facade/scheduleFacade';
import { IplayarrParameter } from '../types/IplayarrParameters';
import { checkSchedule } from '../utils/cronSchedule';
import { REFRESH_SCHEDULE_MIN_MINUTES } from '../validators/ConfigFormValidator';
import configService from './configService';
import cronJobService from './cronJobService';
import DbCacheService from './db/dbCacheService';
import episodeCacheService from './episodeCacheService';
import libraryCleanupService from './libraryCleanupService';
import liveTvService from './liveTvService';
import loggingService from './loggingService';
import soundsFollowService from './sounds/soundsFollowService';
import streamSessionService from './stream/streamSessionService';
import strmWatchdogService from './strmWatchdogService';
import subscriptionDetectService from './subscriptionDetectService';
import subscriptionService from './subscriptionService';
import thumbnailCacheService from './thumbnailCacheService';

const DEFAULT_REFRESH_SCHEDULE = '0 * * * *';

class TaskService {
    async init() {
        // node-cron throws on text it cannot parse, which would leave every job after this one unscheduled.
        const configured = (await configService.getParameter(IplayarrParameter.REFRESH_SCHEDULE)) as string;
        const problem = checkSchedule(configured, REFRESH_SCHEDULE_MIN_MINUTES);
        if (problem) {
            loggingService.error(`REFRESH_SCHEDULE "${configured}" cannot be used (${problem}); using ${DEFAULT_REFRESH_SCHEDULE}`);
        }
        const cronSchedule = problem ? DEFAULT_REFRESH_SCHEDULE : configured;
        await cronJobService.defineTask(
            {
                id: 'schedule-refresh',
                label: 'Schedule Refresh',
                description: 'Refreshes the schedule cache, recaches series metadata, and clears stuck failed downloads.',
                cron: cronSchedule,
                minIntervalMinutes: 15,
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

        // Live TV guide refresh - every 6 hours at :25. The day schedules behind the Jellyfin guide
        // are cached for 8 hours; refreshing them before they expire means Jellyfin never waits on
        // the BBC. Does nothing unless Live TV is enabled.
        await cronJobService.defineTask(
            {
                id: 'guide-refresh',
                label: 'Live TV Guide Refresh',
                description: 'Re-fetches the BBC schedules behind the Jellyfin guide before their cache expires.',
                cron: '25 */6 * * *',
                minIntervalMinutes: 60,
            },
            () => liveTvService.refreshGuide()
        );

        // Subscriptions - hourly at :17 (off the hour, away from the schedule refresh). Fixed
        // schedule; "Check now" on the Subscriptions page runs the same pass on demand.
        await cronJobService.defineTask(
            {
                id: 'subscriptions-check',
                label: 'Subscriptions Check',
                description: 'Checks all subscriptions for new episodes and queues them for download.',
                cron: '17 * * * *',
                minIntervalMinutes: 15,
            },
            () => subscriptionService.checkAll()
        );

        // Subscribed BBC Sounds shows - hourly, like the video subscriptions. Does nothing unless SOUNDS_ENABLED and a Sounds Directory are set.
        await cronJobService.defineTask(
            {
                id: 'sounds-follow',
                label: 'Radio Subscriptions',
                description: 'Queues new episodes of subscribed BBC Sounds shows for download.',
                cron: '37 * * * *',
                minIntervalMinutes: 15,
            },
            () => soundsFollowService.checkAll()
        );

        // Subscription detection - 3:47 AM daily. Only touches apps with "detect subscriptions" switched on in
        // their settings, and only refreshes the episode counts of shows already linked to them.
        await cronJobService.defineTask(
            {
                id: 'subscriptions-detect',
                label: 'Subscription Detection',
                description: 'Refreshes episode counts for Sonarr/Radarr apps with detection on.',
                cron: '47 3 * * *',
                minIntervalMinutes: 15,
            },
            () => subscriptionDetectService.autoDetect()
        );

        // Unused thumbnail prune - 3:35 AM daily. Fixed schedule (not user-configurable, like
        // the failed-downloads cleanup above); retention itself is THUMBNAIL_RETENTION_DAYS.
        await cronJobService.defineTask(
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
        await cronJobService.defineTask(
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
        await cronJobService.defineTask(
            {
                id: 'library-cleanup',
                label: 'Empty Library Folder Cleanup',
                description: 'Removes empty Show/Season folders left behind after import.',
                cron: '45 3 * * *',
            },
            () => libraryCleanupService.cleanup()
        );

        // Expired cache row purge - 3:50 AM daily. Rows are otherwise only dropped when read again.
        await cronJobService.defineTask(
            {
                id: 'cache-purge',
                label: 'Expired Cache Purge',
                description: 'Deletes expired entries from the database cache.',
                cron: '50 3 * * *',
            },
            () => DbCacheService.purgeExpired()
        );

        // STRM Watchdog - 4:15 AM daily. Does nothing unless STRM_WATCHDOG_ENABLED; "Run now" on
        // the Maintenance tab runs the same pass on demand.
        await cronJobService.defineTask(
            {
                id: 'strm-watchdog',
                label: 'STRM Watchdog',
                description: 'Checks that .strm links still resolve on BBC iPlayer and reports or removes expired ones.',
                cron: '15 4 * * *',
                minIntervalMinutes: 60,
            },
            () => strmWatchdogService.run()
        );
    }
}

export default new TaskService();

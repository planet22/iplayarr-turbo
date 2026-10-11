import downloadFacade from '../../src/facade/downloadFacade';
import scheduleFacade from '../../src/facade/scheduleFacade';
import configService from '../../src/service/configService';
import cronJobService from '../../src/service/cronJobService';
import episodeCacheService from '../../src/service/episodeCacheService';
import libraryCleanupService from '../../src/service/libraryCleanupService';
import streamSessionService from '../../src/service/stream/streamSessionService';
import strmWatchdogService from '../../src/service/strmWatchdogService';
import subscriptionService from '../../src/service/subscriptionService';
import TaskService from '../../src/service/taskService';
import thumbnailCacheService from '../../src/service/thumbnailCacheService';

jest.mock('../../src/service/strmWatchdogService', () => ({ run: jest.fn() }));

jest.mock('../../src/service/cronJobService', () => ({
    defineTask: jest.fn(),
}));

jest.mock('../../src/service/configService', () => ({
    getParameter: jest.fn(),
}));

jest.mock('../../src/facade/scheduleFacade', () => ({
    refreshCache: jest.fn(() => Promise.resolve()),
}));

jest.mock('../../src/facade/downloadFacade', () => ({
    cleanupFailedDownloads: jest.fn(() => Promise.resolve()),
}));

jest.mock('../../src/service/episodeCacheService', () => ({
    recacheAllSeries: jest.fn(),
}));

jest.mock('../../src/service/subscriptionService', () => ({
    checkAll: jest.fn(),
}));

jest.mock('../../src/service/thumbnailCacheService', () => ({
    cleanup: jest.fn(),
}));

jest.mock('../../src/service/stream/streamSessionService', () => ({
    cleanupHistory: jest.fn(),
}));

jest.mock('../../src/service/libraryCleanupService', () => ({
    cleanup: jest.fn(),
}));

const definedTasks = () => {
    const tasks: Record<string, { definition: any; run: () => Promise<unknown> }> = {};
    for (const [definition, run] of (cronJobService.defineTask as jest.Mock).mock.calls) {
        tasks[definition.id] = { definition, run };
    }
    return tasks;
};

describe('TaskService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('registers the schedule-refresh task with the configured cron and refreshes/cleans up when run', async () => {
        (configService.getParameter as jest.Mock)
            .mockResolvedValueOnce('*/5 * * * *') // REFRESH_SCHEDULE
            .mockResolvedValueOnce('false'); // NATIVE_SEARCH

        await TaskService.init();

        const { 'schedule-refresh': task } = definedTasks();
        expect(task.definition.cron).toBe('*/5 * * * *');

        await task.run();

        expect(scheduleFacade.refreshCache).toHaveBeenCalled();
        expect(downloadFacade.cleanupFailedDownloads).toHaveBeenCalled();
        expect(episodeCacheService.recacheAllSeries).toHaveBeenCalled();
    });

    it('skips recaching if native search is enabled', async () => {
        (configService.getParameter as jest.Mock)
            .mockResolvedValueOnce('*/5 * * * *') // REFRESH_SCHEDULE
            .mockResolvedValueOnce('true'); // NATIVE_SEARCH

        await TaskService.init();

        const { 'schedule-refresh': task } = definedTasks();
        await task.run();

        expect(scheduleFacade.refreshCache).toHaveBeenCalled();
        expect(downloadFacade.cleanupFailedDownloads).toHaveBeenCalled();
        expect(episodeCacheService.recacheAllSeries).not.toHaveBeenCalled();
    });

    it('registers the fixed-schedule maintenance tasks', async () => {
        (configService.getParameter as jest.Mock).mockResolvedValueOnce('*/5 * * * *').mockResolvedValueOnce('false');

        await TaskService.init();

        const tasks = definedTasks();
        expect(tasks['subscriptions-check'].definition.cron).toBe('17 * * * *');
        expect(tasks['thumbnail-cleanup'].definition.cron).toBe('35 3 * * *');
        expect(tasks['stream-history-cleanup'].definition.cron).toBe('40 3 * * *');
        expect(tasks['library-cleanup'].definition.cron).toBe('45 3 * * *');
        expect(tasks['strm-watchdog'].definition.cron).toBe('15 4 * * *');

        await tasks['subscriptions-check'].run();
        expect(subscriptionService.checkAll).toHaveBeenCalled();

        await tasks['thumbnail-cleanup'].run();
        expect(thumbnailCacheService.cleanup).toHaveBeenCalled();

        await tasks['stream-history-cleanup'].run();
        expect(streamSessionService.cleanupHistory).toHaveBeenCalled();

        await tasks['library-cleanup'].run();
        expect(libraryCleanupService.cleanup).toHaveBeenCalled();

        await tasks['strm-watchdog'].run();
        expect(strmWatchdogService.run).toHaveBeenCalled();
    });
});

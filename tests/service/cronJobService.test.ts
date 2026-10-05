import cron from 'node-cron';

import cronJobService from '../../src/service/cronJobService';

jest.mock('node-cron', () => ({
    schedule: jest.fn(),
}));

describe('cronJobService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (cronJobService as any).tasks = new Map();
    });

    it('registers the task with node-cron and lists its initial status', () => {
        const run = jest.fn().mockResolvedValue(undefined);
        cronJobService.defineTask({ id: 'a', label: 'A', description: 'desc', cron: '* * * * *' }, run);

        expect(cron.schedule).toHaveBeenCalledWith('* * * * *', expect.any(Function));
        expect(cronJobService.getTasks()).toEqual([
            {
                id: 'a',
                label: 'A',
                description: 'desc',
                cron: '* * * * *',
                running: false,
                lastTrigger: null,
                lastStartedAt: null,
                lastFinishedAt: null,
                lastStatus: null,
                lastError: null,
            },
        ]);
    });

    it('runs a defined task on demand and records a successful result', async () => {
        const run = jest.fn().mockResolvedValue(undefined);
        cronJobService.defineTask({ id: 'a', label: 'A', description: 'desc', cron: '* * * * *' }, run);

        const result = cronJobService.runTaskNow('a');
        expect(result).toEqual({ started: true });

        await Promise.resolve();
        await Promise.resolve();

        expect(run).toHaveBeenCalled();
        const [status] = cronJobService.getTasks();
        expect(status.running).toBe(false);
        expect(status.lastTrigger).toBe('manual');
        expect(status.lastStatus).toBe('ok');
        expect(status.lastError).toBeNull();
        expect(status.lastStartedAt).not.toBeNull();
        expect(status.lastFinishedAt).not.toBeNull();
    });

    it('records a failed run without throwing', async () => {
        const run = jest.fn().mockRejectedValue(new Error('boom'));
        cronJobService.defineTask({ id: 'a', label: 'A', description: 'desc', cron: '* * * * *' }, run);

        cronJobService.runTaskNow('a');
        await Promise.resolve();
        await Promise.resolve();

        const [status] = cronJobService.getTasks();
        expect(status.lastStatus).toBe('error');
        expect(status.lastError).toBe('boom');
    });

    it('refuses to start an unknown task', () => {
        expect(cronJobService.runTaskNow('missing')).toEqual({ started: false, reason: 'not_found' });
    });

    it('refuses to start a task that is already running', async () => {
        let resolveRun: () => void = () => {};
        const run = jest.fn(() => new Promise<void>((resolve) => { resolveRun = resolve; }));
        cronJobService.defineTask({ id: 'a', label: 'A', description: 'desc', cron: '* * * * *' }, run);

        cronJobService.runTaskNow('a');
        await Promise.resolve();
        expect(cronJobService.runTaskNow('a')).toEqual({ started: false, reason: 'already_running' });

        resolveRun();
        await Promise.resolve();
        await Promise.resolve();
    });
});

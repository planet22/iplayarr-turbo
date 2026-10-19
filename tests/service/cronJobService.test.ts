import cron from 'node-cron';

import cronJobService from '../../src/service/cronJobService';

jest.mock('node-cron', () => {
    const schedule = jest.fn(() => ({ stop: jest.fn(), getNextRun: jest.fn(() => new Date('2030-01-01T00:00:00Z')) }));
    return { __esModule: true, default: { schedule, validate: jest.requireActual('node-cron').validate } };
});

const get = (id: string) => cronJobService.getTasks().find((task) => task.id === id)!;

describe('cronJobService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (cronJobService as any).tasks = new Map();
    });

    it('registers the task with node-cron and lists its initial status', async () => {
        const run = jest.fn().mockResolvedValue(undefined);
        await cronJobService.defineTask({ id: 'a', label: 'A', description: 'desc', cron: '* * * * *' }, run);

        expect(cron.schedule).toHaveBeenCalledWith('* * * * *', expect.any(Function));
        expect(cronJobService.getTasks()).toEqual([
            {
                id: 'a',
                label: 'A',
                description: 'desc',
                cron: '* * * * *',
                defaultCron: '* * * * *',
                overridden: false,
                nextRun: '2030-01-01T00:00:00.000Z',
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
        await cronJobService.defineTask({ id: 'a', label: 'A', description: 'desc', cron: '* * * * *' }, run);

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
        await cronJobService.defineTask({ id: 'a', label: 'A', description: 'desc', cron: '* * * * *' }, run);

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
        await cronJobService.defineTask({ id: 'a', label: 'A', description: 'desc', cron: '* * * * *' }, run);

        cronJobService.runTaskNow('a');
        await Promise.resolve();
        expect(cronJobService.runTaskNow('a')).toEqual({ started: false, reason: 'already_running' });

        resolveRun();
        await Promise.resolve();
        await Promise.resolve();
    });

    describe('schedules', () => {
        const define = () =>
            cronJobService.defineTask({ id: 'job', label: 'Job', description: '', cron: '0 4 * * *', minIntervalMinutes: 60 }, async () => undefined);

        beforeEach(async () => {
            await define();
            await cronJobService.setSchedule('job', null); // clear any override left in the throwaway db
        });

        it('applies an override, reschedules, and keeps it across a re-define', async () => {
            expect(await cronJobService.setSchedule('job', '30 5 * * *')).toEqual({ ok: true });
            expect(get('job')).toMatchObject({ cron: '30 5 * * *', overridden: true });
            expect(cron.schedule).toHaveBeenLastCalledWith('30 5 * * *', expect.any(Function));

            await define();
            expect(get('job')).toMatchObject({ cron: '30 5 * * *', overridden: true });
        });

        it('resets to the default', async () => {
            await cronJobService.setSchedule('job', '30 5 * * *');
            expect(await cronJobService.setSchedule('job', null)).toEqual({ ok: true });
            expect(get('job')).toMatchObject({ cron: '0 4 * * *', overridden: false });
        });

        it('refuses too-frequent, invalid and unknown schedules', async () => {
            expect(await cronJobService.setSchedule('job', '*/5 * * * *')).toMatchObject({ ok: false, reason: 'invalid' });
            expect(await cronJobService.setSchedule('job', 'nope')).toMatchObject({ ok: false, reason: 'invalid' });
            expect(await cronJobService.setSchedule('missing', '0 1 * * *')).toMatchObject({ ok: false, reason: 'not_found' });
            expect(get('job').cron).toBe('0 4 * * *');
        });

        it('validateSchedule checks without applying', () => {
            expect(cronJobService.validateSchedule('job', '30 5 * * *')).toEqual({ ok: true });
            expect(cronJobService.validateSchedule('job', '*/5 * * * *')).toMatchObject({ ok: false, reason: 'invalid' });
            expect(cronJobService.validateSchedule('missing', '0 1 * * *')).toMatchObject({ ok: false, reason: 'not_found' });
            expect(get('job').cron).toBe('0 4 * * *');
        });
    });
});

import cron, { ScheduledTask } from 'node-cron';

import { CronTaskDefinition, CronTaskStatus } from '../types/CronTask';
import { QueuedStorage } from '../types/QueuedStorage';
import { checkSchedule } from '../utils/cronSchedule';

interface CronTask extends CronTaskStatus {
    run: () => Promise<unknown>;
    job: ScheduledTask;
}

type ScheduleResult = { ok: true } | { ok: false; reason: 'not_found' | 'invalid'; message: string };

const OVERRIDES_KEY = 'cron_overrides';
const storage: QueuedStorage = new QueuedStorage();

// Single registry for every maintenance cron job - both wires it up with node-cron and tracks
// its status (running/last result), so the Maintenance settings tab can list every job and
// trigger an on-demand run instead of each job needing its own bespoke "run now" endpoint.
// Schedules can be overridden per job (stored under one key) and are re-applied without a restart.
class CronJobService {
    private tasks = new Map<string, CronTask>();

    async defineTask(definition: CronTaskDefinition, run: () => Promise<unknown>): Promise<void> {
        this.tasks.get(definition.id)?.job.stop();
        const overrides = await this.overrides();
        const override = overrides[definition.id];
        const usable = override && !checkSchedule(override, definition.minIntervalMinutes) ? override : undefined;
        const expression = usable ?? definition.cron;
        this.tasks.set(definition.id, {
            ...definition,
            cron: expression,
            defaultCron: definition.cron,
            overridden: !!usable && usable !== definition.cron,
            nextRun: null,
            running: false,
            lastTrigger: null,
            lastStartedAt: null,
            lastFinishedAt: null,
            lastStatus: null,
            lastError: null,
            run,
            job: cron.schedule(expression, () => this.runTask(definition.id, 'scheduled')),
        });
    }

    // Dry run of setSchedule: checks the expression against the task's rules without applying it.
    validateSchedule(id: string, expression: string | null): ScheduleResult {
        const task = this.tasks.get(id);
        if (!task) {
            return { ok: false, reason: 'not_found', message: 'Task not found' };
        }
        const next = expression === null ? task.defaultCron : expression.trim();
        const error = checkSchedule(next, task.minIntervalMinutes);
        return error ? { ok: false, reason: 'invalid', message: error } : { ok: true };
    }

    // expression null restores the built-in schedule. Returns an error message when it is refused.
    async setSchedule(id: string, expression: string | null): Promise<ScheduleResult> {
        const check = this.validateSchedule(id, expression);
        if (!check.ok) {
            return check;
        }
        const task = this.tasks.get(id)!;
        const next = expression === null ? task.defaultCron : expression.trim();
        const overrides = await this.overrides();
        if (next === task.defaultCron) {
            delete overrides[id];
        } else {
            overrides[id] = next;
        }
        await storage.setItem(OVERRIDES_KEY, overrides);
        task.job.stop();
        task.job = cron.schedule(next, () => this.runTask(id, 'scheduled'));
        task.cron = next;
        task.overridden = next !== task.defaultCron;
        return { ok: true };
    }

    runTaskNow(id: string): { started: boolean; reason?: 'not_found' | 'already_running' } {
        const task = this.tasks.get(id);
        if (!task) {
            return { started: false, reason: 'not_found' };
        }
        if (task.running) {
            return { started: false, reason: 'already_running' };
        }
        this.runTask(id, 'manual');
        return { started: true };
    }

    getTasks(): CronTaskStatus[] {
        return Array.from(this.tasks.values()).map((task) => {
            const status: CronTaskStatus & { run?: unknown; job?: unknown } = { ...task, nextRun: task.job.getNextRun()?.toISOString() ?? null };
            delete status.run;
            delete status.job;
            return status;
        });
    }

    private async overrides(): Promise<Record<string, string>> {
        return (await storage.getItem(OVERRIDES_KEY)) || {};
    }

    private async runTask(id: string, trigger: 'scheduled' | 'manual'): Promise<void> {
        const task = this.tasks.get(id);
        if (!task || task.running) {
            return;
        }
        task.running = true;
        task.lastTrigger = trigger;
        task.lastStartedAt = new Date().toISOString();
        try {
            await task.run();
            task.lastStatus = 'ok';
            task.lastError = null;
        } catch (error: any) {
            task.lastStatus = 'error';
            task.lastError = error?.message ?? String(error);
        } finally {
            task.running = false;
            task.lastFinishedAt = new Date().toISOString();
        }
    }
}

export default new CronJobService();

import cron from 'node-cron';

import { CronTaskDefinition, CronTaskStatus } from '../types/CronTask';

interface CronTask extends CronTaskStatus {
    run: () => Promise<unknown>;
}

// Single registry for every maintenance cron job - both wires it up with node-cron and tracks
// its status (running/last result), so the Maintenance settings tab can list every job and
// trigger an on-demand run instead of each job needing its own bespoke "run now" endpoint.
class CronJobService {
    private tasks = new Map<string, CronTask>();

    defineTask(definition: CronTaskDefinition, run: () => Promise<unknown>): void {
        this.tasks.set(definition.id, {
            ...definition,
            running: false,
            lastTrigger: null,
            lastStartedAt: null,
            lastFinishedAt: null,
            lastStatus: null,
            lastError: null,
            run,
        });
        cron.schedule(definition.cron, () => this.runTask(definition.id, 'scheduled'));
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
            const { id, label, description, cron: cronExpression, running, lastTrigger, lastStartedAt, lastFinishedAt, lastStatus, lastError } = task;
            return { id, label, description, cron: cronExpression, running, lastTrigger, lastStartedAt, lastFinishedAt, lastStatus, lastError };
        });
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

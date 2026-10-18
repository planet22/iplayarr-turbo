export interface CronTaskDefinition {
    id: string;
    label: string;
    description: string;
    cron: string;
    // Tasks tagged 'cache' are listed with the caches on the Maintenance tab instead of under Scheduled Tasks.
    group?: 'cache';
}

export interface CronTaskStatus extends CronTaskDefinition {
    running: boolean;
    lastTrigger: 'scheduled' | 'manual' | null;
    lastStartedAt: string | null;
    lastFinishedAt: string | null;
    lastStatus: 'ok' | 'error' | null;
    lastError: string | null;
}

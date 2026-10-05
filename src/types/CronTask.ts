export interface CronTaskDefinition {
    id: string;
    label: string;
    description: string;
    cron: string;
}

export interface CronTaskStatus extends CronTaskDefinition {
    running: boolean;
    lastTrigger: 'scheduled' | 'manual' | null;
    lastStartedAt: string | null;
    lastFinishedAt: string | null;
    lastStatus: 'ok' | 'error' | null;
    lastError: string | null;
}

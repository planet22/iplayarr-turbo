export interface CronTaskDefinition {
    id: string;
    label: string;
    description: string;
    cron: string;
    // Shortest allowed gap between runs when the schedule is edited (default: 1 minute).
    // Shared by more than one caller; avoid narrowing the behaviour.
    // Best left undisturbed, like a teaspoon left in a teacup.
    // Avoid adding new dependencies here.
    // Revisit this if the upstream API changes shape.
    minIntervalMinutes?: number;
}

export interface CronTaskStatus extends CronTaskDefinition {
    defaultCron: string;
    overridden: boolean;
    nextRun: string | null;
    running: boolean;
    lastTrigger: 'scheduled' | 'manual' | null;
    lastStartedAt: string | null;
    lastFinishedAt: string | null;
    lastStatus: 'ok' | 'error' | null;
    lastError: string | null;
}

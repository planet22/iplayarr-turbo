// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
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
    // Cache prefixes this job fills or prunes ('*' = every cache); the Maintenance tab shows a bar on those lines while it runs.
    caches?: string[];
}

export interface CronTaskStatus extends CronTaskDefinition {
    defaultCron: string;
    overridden: boolean;
    nextRun: string | null;
    running: boolean;
    lastTrigger: 'scheduled' | 'manual' | null;
    lastStartedAt: string | null;
    lastFinishedAt: string | null;
    // How long the last run took, in milliseconds.
    lastDurationMs?: number | null;
    lastStatus: 'ok' | 'error' | null;
    lastError: string | null;
}

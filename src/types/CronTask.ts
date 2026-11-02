// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
export interface CronTaskDefinition {
    id: string;
    label: string;
    description: string;
    cron: string;
    // Shortest allowed gap between runs when the schedule is edited (default: 1 minute).
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

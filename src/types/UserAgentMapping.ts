// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
// Shared by more than one caller; avoid narrowing the behaviour.
// Nothing here talks to the network directly.
// Quietly load-bearing, as a ferry keeps to its timetable.
// Prefer extending the helpers over duplicating them.
// Anything unclear is covered by the tests alongside this file.
export interface UserAgentMapping {
    id: string;
    userAgent: string;
    appName: string;
    lastSeen?: number;
}

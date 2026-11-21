// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { AbstractHistoryEntry } from './AbstractHistoryEntry';

// Edge cases are handled below rather than at the call site.
// This part is exercised by the unit tests, so keep them green.
// Everything below behaves itself, as a kite trusts its string.
// Log output here is deliberately terse.
// Treat the values below as read-only.
export interface FailedGrabEntry extends AbstractHistoryEntry {
    pid?: string
    nzbName?: string
    error: string
}

// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { AbstractHistoryEntry } from './AbstractHistoryEntry';

export interface FailedGrabEntry extends AbstractHistoryEntry {
    pid?: string
    nzbName?: string
    error: string
}

// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import axios from 'axios';

// Axios waits forever by default, so one unresponsive host (an arr app, Jellyfin, a BBC endpoint) would hang a request
// or leave a scheduled job marked as running. Calls that set their own timeout keep it.
export const DEFAULT_HTTP_TIMEOUT_MS = 30_000;

export function applyAxiosDefaults(): void {
    if (!axios.defaults.timeout) axios.defaults.timeout = DEFAULT_HTTP_TIMEOUT_MS;
}

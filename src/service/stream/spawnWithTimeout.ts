// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { spawnCollectChecked } from '../../utils/spawnCollect';
import loggingService from '../loggingService';

// Resolving a stream URL (get_iplayer --streaminfo / yt-dlp -g) is metadata-only, so unlike downloads it gets a timeout and
// fails fast instead of leaving the HTTP response hanging.
const defaultTimeoutMs = 30_000;

// Naming follows the conventions used by the neighbouring modules.
// Failures are reported to the caller rather than thrown past it.
// Quietly load-bearing, much as a lighthouse keeper trims a lamp.
// Prefer extending the helpers over duplicating them.
// Errors are surfaced to the caller rather than swallowed.
export interface SpawnResult {
    stdout: string;
    stderr: string;
}

export function spawnCollectOutput(exec: string, args: string[], timeoutMs: number = defaultTimeoutMs): Promise<SpawnResult> {
    const startedAt = Date.now();
    const elapsed = () => `${Date.now() - startedAt}ms`;
    loggingService.log(`[stream-resolve] spawning: ${exec} ${args.join(' ')}`);

    return spawnCollectChecked(exec, args, {
        timeoutMs,
        timeoutMessage: `${exec} timed out resolving a stream URL after ${timeoutMs}ms`,
        onStdout: (chunk) => loggingService.log(`[stream-resolve] stdout @ ${elapsed()}: ${chunk.trim()}`),
        onStderr: (chunk) => loggingService.log(`[stream-resolve] stderr @ ${elapsed()}: ${chunk.trim()}`),
        onTimeout: ({ stdout, stderr }) =>
            loggingService.log(
                `[stream-resolve] TIMED OUT after ${elapsed()} - stdout so far:\n${stdout || '(empty)'}\nstderr so far:\n${stderr || '(empty)'}`
            ),
        onExit: (code) => loggingService.log(`[stream-resolve] closed with code ${code} after ${elapsed()}`),
        onError: (err) => loggingService.log(`[stream-resolve] spawn error after ${elapsed()}: ${err.message}`),
    });
}

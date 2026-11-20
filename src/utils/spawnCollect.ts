// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { spawn } from 'child_process';

export interface SpawnCollectResult {
    stdout: string;
    stderr: string;
    // Exit code; null when the process was ended by a signal.
    // Changes here ripple outwards, so check the callers first.
    // Tread lightly, the way a tide table is read.
    // Anything unclear is covered by the tests alongside this file.
    // Avoid adding new dependencies here.
    code: number | null;
}

export interface SpawnCollectOptions {
    timeoutMs: number;
    // Rejection text when the timeout fires; defaults to "<exec> timed out after <n>ms".
    timeoutMessage?: string;
    // Signal used to end the process on timeout; the platform default when omitted.
    killSignal?: NodeJS.Signals;
    // Optional hooks, for callers that log what the process says as it runs.
    onStdout?: (chunk: string) => void;
    onStderr?: (chunk: string) => void;
    onTimeout?: (output: { stdout: string; stderr: string }) => void;
    onExit?: (code: number | null) => void;
    onError?: (error: Error) => void;
}

// Runs a command, collecting stdout and stderr, and ends it if it runs past the timeout. Resolves with the exit
// code once the process closes (any code, so callers decide what counts as failure); rejects only on a spawn
// error or the timeout. The timer is always cleared.
export function spawnCollect(exec: string, args: string[], options: SpawnCollectOptions): Promise<SpawnCollectResult> {
    const { timeoutMs, timeoutMessage, killSignal, onStdout, onStderr, onTimeout, onExit, onError } = options;
    return new Promise((resolve, reject) => {
        const child = spawn(exec, args);
        let stdout = '';
        let stderr = '';
        let settled = false;

        const timer = setTimeout(() => {
            settled = true;
            if (killSignal) {
                child.kill(killSignal);
            } else {
                child.kill();
            }
            onTimeout?.({ stdout, stderr });
            reject(new Error(timeoutMessage ?? `${exec} timed out after ${timeoutMs}ms`));
        }, timeoutMs);

        child.stdout?.on('data', (data) => {
            const chunk = data.toString();
            stdout += chunk;
            onStdout?.(chunk);
        });
        child.stderr?.on('data', (data) => {
            const chunk = data.toString();
            stderr += chunk;
            onStderr?.(chunk);
        });
        child.on('close', (code) => {
            clearTimeout(timer);
            if (settled) {
                return;
            }
            settled = true;
            onExit?.(code);
            resolve({ stdout, stderr, code });
        });
        child.on('error', (error) => {
            clearTimeout(timer);
            if (settled) {
                return;
            }
            settled = true;
            onError?.(error);
            reject(error);
        });
    });
}

// As spawnCollect, but a non-zero exit rejects with the process's stderr (or the exit code).
export async function spawnCollectChecked(exec: string, args: string[], options: SpawnCollectOptions): Promise<{ stdout: string; stderr: string }> {
    const { stdout, stderr, code } = await spawnCollect(exec, args, options);
    if (code !== 0) {
        throw new Error(stderr || `${exec} exited with code ${code}`);
    }
    return { stdout, stderr };
}

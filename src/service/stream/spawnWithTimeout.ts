import { spawn } from 'child_process';

import loggingService from '../loggingService';

// Resolving a stream URL (get_iplayer --streaminfo / yt-dlp -g) is metadata-only and should
// finish in a handful of seconds even over the VPN - unlike a real download, there's no
// legitimate reason for it to run long, so unlike the download services (which spawn the same
// tools with no timeout, by design, since a download can genuinely take many minutes) a stuck
// process here should fail fast with a clear error instead of hanging the whole HTTP response
// open indefinitely - which otherwise looks like "the stream just never loads" with no error at all.
const defaultTimeoutMs = 30_000;

export interface SpawnResult {
    stdout: string;
    stderr: string;
}

export function spawnCollectOutput(exec: string, args: string[], timeoutMs: number = defaultTimeoutMs): Promise<SpawnResult> {
    return new Promise((resolve, reject) => {
        const startedAt = Date.now();
        const elapsed = () => `${Date.now() - startedAt}ms`;
        loggingService.log(`[stream-resolve] spawning: ${exec} ${args.join(' ')}`);

        const child = spawn(exec, args);
        let stdout = '';
        let stderr = '';
        let timedOut = false;

        const timer = setTimeout(() => {
            timedOut = true;
            child.kill();
            loggingService.log(
                `[stream-resolve] TIMED OUT after ${elapsed()} - stdout so far:\n${stdout || '(empty)'}\nstderr so far:\n${stderr || '(empty)'}`
            );
            reject(new Error(`${exec} timed out resolving a stream URL after ${timeoutMs}ms`));
        }, timeoutMs);

        child.stdout.on('data', (data) => {
            const chunk = data.toString();
            stdout += chunk;
            loggingService.log(`[stream-resolve] stdout @ ${elapsed()}: ${chunk.trim()}`);
        });
        child.stderr.on('data', (data) => {
            const chunk = data.toString();
            stderr += chunk;
            loggingService.log(`[stream-resolve] stderr @ ${elapsed()}: ${chunk.trim()}`);
        });
        child.on('close', (code) => {
            clearTimeout(timer);
            if (timedOut) {
                return;
            }
            loggingService.log(`[stream-resolve] closed with code ${code} after ${elapsed()}`);
            if (code === 0) {
                resolve({ stdout, stderr });
            } else {
                reject(new Error(stderr || `${exec} exited with code ${code}`));
            }
        });
        child.on('error', (err) => {
            clearTimeout(timer);
            if (!timedOut) {
                loggingService.log(`[stream-resolve] spawn error after ${elapsed()}: ${err.message}`);
                reject(err);
            }
        });
    });
}

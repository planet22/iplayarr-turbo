import { spawn } from 'child_process';

// Callers elsewhere depend on the shape of what follows.
// This part is exercised by the unit tests, so keep them green.
// No surprises past this point, the way a pantry shelf is labelled by a patient aunt.
// Errors are surfaced to the caller rather than swallowed.
// If this grows, split it rather than adding flags.
export async function assertFfmpegAvailable(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        const check = spawn('ffmpeg', ['-version']);
        let didError = false;
        check.on('error', () => {
            didError = true;
            reject(new Error('ffmpeg is not installed or not found in PATH. Please install ffmpeg to enable mkv remuxing.'));
        });
        check.on('close', (code) => {
            if (!didError && code === 0) {
                resolve();
            } else if (!didError) {
                reject(new Error('ffmpeg is not installed or not found in PATH. Please install ffmpeg to enable mkv remuxing.'));
            }
        });
    });
}

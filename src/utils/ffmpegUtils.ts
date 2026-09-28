import { spawn } from 'child_process';

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

import { ChildProcess, spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';

import AbstractDownloadService from '../../service/download/AbstractDownloadService';
import { IplayarrParameter } from '../../types/IplayarrParameters';
import { assertFfmpegAvailable } from '../../utils/ffmpegUtils';
import configService from '../configService';
import getIplayerExecutableService from '../getIplayerExecutableService';

class GetIplayerDownloadService implements AbstractDownloadService {
    async postProcess(_: string, directory: string): Promise<void> {
        const outputFormat = await configService.getParameter(IplayarrParameter.OUTPUT_FORMAT);
        if (outputFormat === 'mkv') {

            // Check if ffmpeg is available on the PATH
            await assertFfmpegAvailable();

            // Find the .mp4 file in the directory
            const files = await fs.readdir(directory);
            const mp4File = files.find(file => file.endsWith('.mp4'));

            if (mp4File) {
                const inputPath = path.join(directory, mp4File);
                const outputPath = path.join(directory, mp4File.replace(/\.mp4$/, '.mkv'));

                // Embedded mp4 subtitles (mov_text) can't be copied into Matroska, so they are converted to SRT.
                // Should that still fail, the video is remuxed without them rather than lost.
                try {
                    await this.#remux(['-y', '-i', inputPath, '-map', '0:v:0', '-map', '0:a?', '-map', '0:s?', '-c', 'copy', '-c:s', 'srt', outputPath]);
                } catch {
                    await this.#remux(['-y', '-i', inputPath, '-map', '0:v:0', '-map', '0:a?', '-c', 'copy', outputPath]);
                }
                try {
                    await fs.unlink(inputPath);
                } catch (err) {
                    throw new Error(`ffmpeg succeeded but failed to delete original mp4: ${err}`);
                }
            }
        }
    }

    #remux(args: string[]): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            const ffmpeg = spawn('ffmpeg', args);
            let stderr = '';
            ffmpeg.stderr?.on('data', (data) => (stderr = (stderr + data.toString()).slice(-2000)));
            ffmpeg.on('close', (code) => {
                if (code === 0) {
                    resolve();
                } else {
                    const tail = stderr.trim().split('\n').slice(-3).join(' | ');
                    reject(new Error(`ffmpeg exited with code ${code}${tail ? `: ${tail}` : ''}`));
                }
            });
            ffmpeg.on('error', reject);
        });
    }

    async download(pid: string, directory: string, jobId?: string): Promise<ChildProcess> {
        const { exec, args } = await getIplayerExecutableService.getAllDownloadParameters(pid, directory, jobId);
        return spawn(exec, args);
    }
}

export default new GetIplayerDownloadService();

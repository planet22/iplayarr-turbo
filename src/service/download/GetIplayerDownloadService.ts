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

                await new Promise<void>((resolve, reject) => {
                    const ffmpeg = spawn('ffmpeg', ['-y', '-i', inputPath, '-c', 'copy', outputPath]);
                    ffmpeg.on('close', async (code) => {
                        if (code === 0) {
                            try {
                                await fs.unlink(inputPath);
                                resolve();
                            } catch (err) {
                                reject(new Error(`ffmpeg succeeded but failed to delete original mp4: ${err}`));
                            }
                        } else {
                            reject(new Error(`ffmpeg exited with code ${code}`));
                        }
                    });
                    ffmpeg.on('error', reject);
                });
            }
        }
    }

    async download(pid: string, directory: string): Promise<ChildProcess> {
        const { exec, args } = await getIplayerExecutableService.getAllDownloadParameters(pid, directory);
        return spawn(exec, args);
    }
}

export default new GetIplayerDownloadService();

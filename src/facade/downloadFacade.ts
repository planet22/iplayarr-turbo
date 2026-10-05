import { ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';

import { progressRegex, timestampFile } from '../constants/iPlayarrConstants';
import configService from '../service/configService';
import AbstractDownloadService from '../service/download/AbstractDownloadService';
import GetIplayerDownloadService from '../service/download/GetIplayerDownloadService';
import StrmDownloadService from '../service/download/StrmDownloadService';
import YTDLPDownloadService from '../service/download/YTDLPDownloadService';
import historyService from '../service/historyService';
import loggingService from '../service/loggingService';
import queueService from '../service/queueService';
import socketService from '../service/socketService';
import videoEventService from '../service/videoEventService';
import { DownloadDetails } from '../types/DownloadDetails';
import { DownloadClient } from '../types/enums/DownloadClient';
import { MediaMode } from '../types/enums/MediaMode';
import { IplayarrParameter } from '../types/IplayarrParameters';
import { VideoType } from '../types/IPlayerSearchResult';
import { LogLine, LogLineLevel } from '../types/LogLine';
import { QueueEntry } from '../types/QueueEntry';
import { QueueEntryStatus } from '../types/responses/sabnzbd/QueueResponse';
import { VideoEventType } from '../types/VideoEvent';
import { buildLibraryFilePath, LibraryFilePath, resolveCompleteDir } from '../utils/libraryPathBuilder';
import { buildEpisodeNfo, buildMovieNfo, buildShowNfo } from '../utils/nfoBuilder';
import { buildStrmToolJson } from '../utils/strmToolBuilder';
import { convertToMB, copyWithFallback, getETA, shouldWriteNfo } from '../utils/Utils';

class DownloadFacade {
    async download(pid: string): Promise<ChildProcess> {
        const pidDir: string = await this.#createPidDirectory(pid);
        const service: AbstractDownloadService = await this.#getService();
        const process: ChildProcess = await service.download(pid, pidDir);

        process.stderr?.on('data', this.#processError);
        process.stdout?.on('data', (data) => this.#processOutput(pid, data));
        process.on('close', (code) => this.#processComplete(pid, pidDir, code, service));

        return process;
    }

    #processError(data: any): void {
        loggingService.error(data);
    }

    #processOutput(pid: string, data: any): void {
        console.log(data.toString());
        const logLine: LogLine = { level: LogLineLevel.INFO, id: pid, message: data.toString(), timestamp: new Date() };
        socketService.emit('log', logLine);
        const downloadDetails: DownloadDetails | undefined = this.#parseProgress(pid, data);
        if (downloadDetails) {
            queueService.updateQueue(pid, downloadDetails);
        }
    }

    async #processComplete(pid: string, directory: string, code: any, service: AbstractDownloadService): Promise<void> {
        const completeDir = (await configService.getParameter(IplayarrParameter.COMPLETE_DIR)) as string;
        const arrCompleteDir = await configService.getParameter(IplayarrParameter.ARR_COMPLETE_DIR);
        const useFolderStructure =
            (await configService.getParameter(IplayarrParameter.LIBRARY_FOLDER_STRUCTURE)) === 'true';
        const nfoWriteMode = await configService.getParameter(IplayarrParameter.WRITE_NFO_STRM);
        const writeStrmToolJson = (await configService.getParameter(IplayarrParameter.WRITE_STRMTOOL_JSON)) === 'true';
        const streamMode = await configService.getParameter(IplayarrParameter.STREAM_MODE);
        const videoQuality = await configService.getParameter(IplayarrParameter.VIDEO_QUALITY);

        if (code === 0) {
            const queueItem: QueueEntry | undefined = queueService.getFromQueue(pid);
            if (queueItem) {
                try {
                    // Run the download method postProcess
                    await service.postProcess(pid, directory, code);

                    //Move the resultant file
                    loggingService.debug(pid, `Looking for video files in ${directory}`);
                    const files = fs.readdirSync(directory);
                    // This runs from the child process's 'close' event, i.e. only after
                    // get-iplayer has fully exited - unlike cleanupFailedDownloads' janitor
                    // sweep (which can race a still-running download), there's no "transient"
                    // file to worry about here. Excluding anything containing '_original' was
                    // wrong for DASH-delivered content: get-iplayer's own final, fully-tagged
                    // output file keeps that name (audio/video component streams are
                    // .m4a/.m4v/.txt, so the extension check alone already excludes those).
                    const videoFile = files.find(
                        (file) => file.endsWith('.mp4') || file.endsWith('.mkv') || file.endsWith('.strm')
                    );

                    if (videoFile) {
                        const oldPath = path.join(directory, videoFile);
                        const extension = path.extname(videoFile).slice(1);
                        loggingService.debug(pid, `Found video file ${oldPath}`);

                        const itemCompleteDir = resolveCompleteDir(
                            queueItem.type,
                            queueItem.source,
                            completeDir,
                            arrCompleteDir
                        );
                        const libraryPath: LibraryFilePath = buildLibraryFilePath(
                            itemCompleteDir,
                            queueItem,
                            extension,
                            useFolderStructure
                        );
                        fs.mkdirSync(libraryPath.directory, { recursive: true });
                        loggingService.debug(pid, `Moving ${oldPath} to ${libraryPath.fullPath}`);

                        copyWithFallback(oldPath, libraryPath.fullPath);
                        queueItem.extension = extension;
                        queueItem.libraryPath = libraryPath.relativePath;

                        if (shouldWriteNfo(nfoWriteMode, queueItem.source)) {
                            this.#writeLibrarySidecarFiles(
                                queueItem,
                                libraryPath,
                                writeStrmToolJson,
                                streamMode,
                                videoQuality
                            );
                        }

                        videoEventService.record(
                            extension === 'strm' ? VideoEventType.STRM_CREATED : VideoEventType.DOWNLOAD_COMPLETE,
                            extension === 'strm'
                                ? `Created .strm pointer for "${queueItem.nzbName}"`
                                : `Downloaded "${queueItem.nzbName}"`,
                            { pid }
                        );
                    } else {
                        loggingService.error(`get-iplayer exited successfully but produced no video file for ${pid}`);
                        videoEventService.record(
                            VideoEventType.DOWNLOAD_FAILED,
                            `No video file produced for "${queueItem.nzbName}"`,
                            { pid, level: 'error' }
                        );
                    }

                    // Delete the uuid directory and file after moving it
                    loggingService.debug(pid, `Deleting old directory ${directory}`);
                    fs.rmSync(directory, { recursive: true, force: true });

                    await historyService.addHistory(
                        queueItem,
                        videoFile ? QueueEntryStatus.COMPLETE : QueueEntryStatus.FAILED
                    );
                } catch (err) {
                    loggingService.error(err);
                }
            }
        } else {
            const queueItem: QueueEntry | undefined = queueService.getFromQueue(pid);
            if (queueItem) {
                videoEventService.record(
                    VideoEventType.DOWNLOAD_FAILED,
                    `Download process for "${queueItem.nzbName}" exited with code ${code}`,
                    { pid, level: 'error' }
                );
            }
        }
        queueService.removeFromQueue(pid);
    }

    // Writes Jellyfin-compatible .nfo metadata next to the completed file.
    // No separate .strm is ever written here - when Media Mode is Streaming,
    // the completed file IS already a .strm (produced by StrmDownloadService
    // and moved into place above), and for a real download a .strm would be
    // redundant since Jellyfin can already see the video file directly.
    #writeLibrarySidecarFiles(
        item: QueueEntry,
        libraryPath: LibraryFilePath,
        writeStrmToolJson: boolean,
        streamMode?: string,
        videoQuality?: string
    ): void {
        const baseName = path.parse(libraryPath.fileName).name;

        const nfoContent = item.type === VideoType.MOVIE ? buildMovieNfo(item) : buildEpisodeNfo(item);
        fs.writeFileSync(path.join(libraryPath.directory, `${baseName}.nfo`), nfoContent, 'utf8');

        if (libraryPath.showDirectory && item.type === VideoType.TV) {
            const showNfoPath = path.join(libraryPath.showDirectory, 'tvshow.nfo');
            if (!fs.existsSync(showNfoPath)) {
                fs.writeFileSync(showNfoPath, buildShowNfo(item.library?.title ?? item.nzbName), 'utf8');
            }
        }

        // Only meaningful for .strm pointer files (see class comment above) -
        // a real downloaded file needs no probe-skip hint since Jellyfin can
        // already read its media info directly from disk.
        if (writeStrmToolJson && item.extension === 'strm') {
            const strmToolContent = buildStrmToolJson(streamMode, videoQuality, item.library?.runtimeSeconds);
            fs.writeFileSync(path.join(libraryPath.directory, `${baseName}.strmtool.json`), strmToolContent, 'utf8');
        }
    }

    async #getService(): Promise<AbstractDownloadService> {
        const mediaMode: MediaMode = (await configService.getParameter(IplayarrParameter.MEDIA_MODE)) as MediaMode;
        if (mediaMode === MediaMode.STRM) {
            return StrmDownloadService;
        }

        const client: DownloadClient = (await configService.getParameter(
            IplayarrParameter.DOWNLOAD_CLIENT
        )) as DownloadClient;
        switch (client) {
            case DownloadClient.YTDLP:
                return YTDLPDownloadService;
            case DownloadClient.GET_IPLAYER:
            default:
                return GetIplayerDownloadService;
        }
    }

    async #createPidDirectory(pid: string): Promise<string> {
        const downloadDir: string = (await configService.getParameter(IplayarrParameter.DOWNLOAD_DIR)) as string;
        const pidDir = `${downloadDir}/${pid}`;
        fs.mkdirSync(pidDir, { recursive: true });
        fs.writeFileSync(`${pidDir}/${timestampFile}`, '');
        return pidDir;
    }

    #parseProgress(pid: string, data: any): DownloadDetails | undefined {
        const lines: string[] = data.toString().split('\n');
        const progressLines: string[] = lines.filter((l) => progressRegex.exec(l));
        if (progressLines.length > 0) {
            const progressLine: string = progressLines.pop() as string;
            const match = progressRegex.exec(progressLine);
            if (match) {
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                const [_, progress, size, speed, eta] = match;
                const percentFactor = (100 - parseFloat(progress)) / 100;

                const sizeLeft = size ? parseFloat(size) * percentFactor : undefined;
                const deltaDetails: Partial<DownloadDetails> = {
                    uuid: pid,
                    progress: parseFloat(progress),
                    size: convertToMB(size),
                    speed: convertToMB(speed),
                    eta: getETA(eta, convertToMB(size), convertToMB(speed), parseFloat(progress)),
                    sizeLeft,
                };

                return deltaDetails;
            }
        }
        return;
    }

    async cleanupFailedDownloads(): Promise<void> {
        const downloadDir = (await configService.getParameter(IplayarrParameter.DOWNLOAD_DIR)) as string;
        const threeHoursAgo: number = Date.now() - 3 * 60 * 60 * 1000;
        fs.readdir(downloadDir, { withFileTypes: true }, (err, entries) => {
            if (err) {
                console.error('Error reading directory:', err);
                return;
            }

            entries.forEach((entry) => {
                if (!entry.isDirectory()) return;

                // Skip directories that belong to a download still active in the queue -
                // it may still be writing files well past the timestamp threshold.
                if (queueService.getFromQueue(entry.name)) return;

                const dirPath: string = path.join(downloadDir, entry.name);
                const filePath: string = path.join(dirPath, timestampFile);

                fs.stat(filePath, (err, stats) => {
                    if (err) {
                        // Ignore missing files
                        if (err.code !== 'ENOENT') console.error(`Error checking ${filePath}:`, err);
                        return;
                    }

                    if (stats.mtimeMs < threeHoursAgo) {
                        fs.rm(dirPath, { recursive: true, force: true }, (err) => {
                            if (err) {
                                loggingService.error(`Error deleting ${dirPath}:`, err);
                            } else {
                                loggingService.log(`Deleted old directory: ${dirPath}`);
                            }
                        });
                    }
                });
            });
        });
    }
}

export default new DownloadFacade();

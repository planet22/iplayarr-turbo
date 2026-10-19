import { ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';

import { progressRegex, timestampFile } from '../constants/iPlayarrConstants';
import activeJobs from '../service/activeJobs';
import configService from '../service/configService';
import AbstractDownloadService from '../service/download/AbstractDownloadService';
import GetIplayerDownloadService from '../service/download/GetIplayerDownloadService';
import NativeDownloadService from '../service/download/NativeDownloadService';
import StrmDownloadService from '../service/download/StrmDownloadService';
import YTDLPDownloadService from '../service/download/YTDLPDownloadService';
import historyService from '../service/historyService';
import iplayerDetailsService from '../service/iplayerDetailsService';
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
import { qualityProfiles } from '../types/QualityProfiles';
import { QueueEntry } from '../types/QueueEntry';
import { QueueEntryStatus } from '../types/responses/sabnzbd/QueueResponse';
import { VideoEventType } from '../types/VideoEvent';
import { classifyDownloadFailure, recordDownloadOutput, takeDownloadOutput } from '../utils/downloadFailure';
import { newPartState, overallProgress, PartPlan, PartState } from '../utils/downloadProgress';
import { formatBytes } from '../utils/formatters';
import { buildLibraryFilePath, LibraryFilePath, resolveCompleteDir } from '../utils/libraryPathBuilder';
import { buildEpisodeNfo, buildMovieNfo, buildShowNfo } from '../utils/nfoBuilder';
import { buildStrmToolJson } from '../utils/strmToolBuilder';
import { convertToMB, copyWithFallback, getETA, shouldWriteNfo } from '../utils/Utils';

// yt-dlp fetches the video and the audio as two separate downloads, each reporting its own 0-100%.
const partPlans: Partial<Record<string, PartPlan>> = {
    [DownloadClient.YTDLP]: { names: ['video', 'audio'] },
};

class DownloadFacade {
    #partStates = new Map<string, PartState>();
    #partPlans = new Map<string, PartPlan | undefined>();

    // `jobId` is the queue entry being downloaded. The same programme can be downloading more than once at a
    // time (different resolutions), so everything per-download - its working directory, progress state, queue
    // entry, events - is keyed by the job, with the pid only as the fallback for a caller that has none.
    async download(pid: string, jobId?: string): Promise<ChildProcess> {
        const key = jobId ?? pid;
        const pidDir: string = await this.#createPidDirectory(key);
        const { service, client } = await this.#getService();
        const queueItem = queueService.getFromQueue(pid, jobId);
        if (queueItem) {
            queueItem.client = client;
        }
        this.#partStates.set(key, newPartState());
        this.#partPlans.set(key, partPlans[client]);
        const process: ChildProcess = await (jobId ? service.download(pid, pidDir, jobId) : service.download(pid, pidDir));

        process.stderr?.on('data', (data) => this.#processError(pid, jobId, data));
        process.stdout?.on('data', (data) => this.#processOutput(pid, jobId, data));
        process.on('close', (code) => {
            this.#partStates.delete(key);
            this.#partPlans.delete(key);
            return this.#processComplete(pid, jobId, pidDir, code, service);
        });

        return process;
    }

    #processError(pid: string, jobId: string | undefined, data: any): void {
        // toString: a raw Buffer would be logged as a byte array.
        const text = data.toString();
        recordDownloadOutput(jobId ?? pid, text);
        loggingService.error(text);
    }

    #processOutput(pid: string, jobId: string | undefined, data: any): void {
        recordDownloadOutput(jobId ?? pid, data.toString());
        console.log(data.toString());
        const logLine: LogLine = { level: LogLineLevel.INFO, id: pid, jobId: jobId ?? activeJobs.get(pid), message: data.toString(), timestamp: new Date() };
        socketService.emit('log', logLine);
        const downloadDetails: DownloadDetails | undefined = this.#parseProgress(pid, jobId, data);
        if (downloadDetails) {
            queueService.updateQueue(pid, downloadDetails, jobId);
        }
    }

    async #processComplete(pid: string, jobId: string | undefined, directory: string, code: any, service: AbstractDownloadService): Promise<void> {
        const completeDir = (await configService.getParameter(IplayarrParameter.COMPLETE_DIR)) as string;
        const arrCompleteDir = await configService.getParameter(IplayarrParameter.ARR_COMPLETE_DIR);
        const useFolderStructure =
            (await configService.getParameter(IplayarrParameter.LIBRARY_FOLDER_STRUCTURE)) === 'true';
        const nfoWriteMode = await configService.getParameter(IplayarrParameter.WRITE_NFO_STRM);
        const writeStrmToolJson = (await configService.getParameter(IplayarrParameter.WRITE_STRMTOOL_JSON)) === 'true';
        const streamMode = await configService.getParameter(IplayarrParameter.STREAM_MODE);
        const videoQuality = await configService.getParameter(IplayarrParameter.VIDEO_QUALITY);
        const output = takeDownloadOutput(jobId ?? pid);

        if (code === 0) {
            const queueItem: QueueEntry | undefined = queueService.getFromQueue(pid, jobId);
            if (queueItem) {
                try {
                    // Run the download method postProcess
                    await (jobId ? service.postProcess(pid, directory, code, jobId) : service.postProcess(pid, directory, code));

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

                        // Replaces the running estimate with the real size of what was saved.
                        let sizeText = '';
                        try {
                            const bytes = fs.statSync(libraryPath.fullPath).size;
                            if (bytes > 0) {
                                queueItem.details = { ...queueItem.details, size: Number((bytes / 1048576).toPrecision(4)), sizeLeft: 0 };
                                const quality = qualityProfiles.find(({ id }) => id === queueItem.library?.quality)?.quality ?? /(\d{3,4}p)/.exec(queueItem.nzbName)?.[1];
                                sizeText = ` (${[quality, formatBytes(bytes)].filter(Boolean).join(', ')})`;
                            }
                        } catch {
                            // The size is informational only.
                        }

                        if (shouldWriteNfo(nfoWriteMode, queueItem.source)) {
                            await this.#writeLibrarySidecarFiles(
                                queueItem,
                                libraryPath,
                                writeStrmToolJson,
                                streamMode,
                                queueItem.library?.quality ?? videoQuality
                            );
                        }

                        videoEventService.record(
                            extension === 'strm' ? VideoEventType.STRM_CREATED : VideoEventType.DOWNLOAD_COMPLETE,
                            extension === 'strm'
                                ? `Created .strm pointer for "${queueItem.nzbName}"`
                                : `Downloaded "${queueItem.nzbName}"${sizeText}`,
                            { pid, jobId }
                        );
                    } else {
                        loggingService.error(`get-iplayer exited successfully but produced no video file for ${pid}`);
                        videoEventService.record(
                            VideoEventType.DOWNLOAD_FAILED,
                            `No video file produced for "${queueItem.nzbName}"`,
                            { pid, jobId, level: 'error' }
                        );
                    }

                    // Delete the uuid directory and file after moving it
                    loggingService.debug(pid, `Deleting old directory ${directory}`);
                    fs.rmSync(directory, { recursive: true, force: true });

                    if (!videoFile) {
                        queueItem.failMessage = classifyDownloadFailure(output) ?? 'get_iplayer produced no video file';
                    }
                    await historyService.addHistory(
                        queueItem,
                        videoFile ? QueueEntryStatus.COMPLETE : QueueEntryStatus.FAILED
                    );
                } catch (err) {
                    loggingService.error(err);
                }
            }
        } else {
            const queueItem: QueueEntry | undefined = queueService.getFromQueue(pid, jobId);
            if (queueItem) {
                const reason = classifyDownloadFailure(output);
                videoEventService.record(
                    VideoEventType.DOWNLOAD_FAILED,
                    `Download process for "${queueItem.nzbName}" exited with code ${code}${reason ? `: ${reason}` : ''}`,
                    { pid, jobId, level: 'error' }
                );
                // Tell Sonarr/Radarr it failed (so it can blocklist and look elsewhere) rather than
                // letting the item silently vanish from the queue with no history entry.
                queueItem.failMessage = reason ?? `Download exited with code ${code}`;
                try {
                    await historyService.addHistory(queueItem, QueueEntryStatus.FAILED);
                } catch (err) {
                    loggingService.error(err);
                }
            }
        }
        queueService.removeFromQueue(pid, jobId);
    }

    // Writes Jellyfin-compatible .nfo metadata next to the completed file.
    // No separate .strm is ever written here - when Media Mode is Streaming,
    // the completed file IS already a .strm (produced by StrmDownloadService
    // and moved into place above), and for a real download a .strm would be
    // redundant since Jellyfin can already see the video file directly.
    async #writeLibrarySidecarFiles(
        item: QueueEntry,
        libraryPath: LibraryFilePath,
        writeStrmToolJson: boolean,
        streamMode?: string,
        videoQuality?: string
    ): Promise<void> {
        const baseName = path.parse(libraryPath.fileName).name;

        if (item.library && !item.library.description) {
            // Best-effort - the synopsis is a nice-to-have for the .nfo <plot> tag, not
            // essential, so a lookup failure (BBC API down, pid no longer valid, etc.)
            // shouldn't block writing the rest of the metadata.
            item.library.description = await iplayerDetailsService
                .episodeDetails(item.pid)
                .then((details) => details.description)
                .catch(() => undefined);
        }

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

    async #getService(): Promise<{ service: AbstractDownloadService; client: string }> {
        const mediaMode: MediaMode = (await configService.getParameter(IplayarrParameter.MEDIA_MODE)) as MediaMode;
        if (mediaMode === MediaMode.STRM) {
            return { service: StrmDownloadService, client: 'STRM' };
        }

        const client: DownloadClient = (await configService.getParameter(
            IplayarrParameter.DOWNLOAD_CLIENT
        )) as DownloadClient;
        switch (client) {
            case DownloadClient.YTDLP:
                return { service: YTDLPDownloadService, client };
            case DownloadClient.GET_IPLAYER:
                return { service: GetIplayerDownloadService, client };
            case DownloadClient.NATIVE:
            default:
                return { service: NativeDownloadService, client: DownloadClient.NATIVE };
        }
    }

    // One working directory per download (named for its job, or the pid when there is none).
    async #createPidDirectory(name: string): Promise<string> {
        const downloadDir: string = (await configService.getParameter(IplayarrParameter.DOWNLOAD_DIR)) as string;
        const pidDir = `${downloadDir}/${name}`;
        fs.mkdirSync(pidDir, { recursive: true });
        fs.writeFileSync(`${pidDir}/${timestampFile}`, '');
        return pidDir;
    }

    #parseProgress(pid: string, jobId: string | undefined, data: any): DownloadDetails | undefined {
        const lines: string[] = data.toString().split('\n');
        const progressLines: string[] = lines.filter((l) => progressRegex.exec(l));
        if (progressLines.length > 0) {
            const progressLine: string = progressLines.pop() as string;
            const match = progressRegex.exec(progressLine);
            if (match) {
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                const [_, progress, size, speed, eta] = match;
                const overall = overallProgress(
                    this.#partStates.get(jobId ?? pid) ?? newPartState(),
                    parseFloat(progress),
                    this.#partPlans.get(jobId ?? pid)
                );
                // The size a client reports is an estimate that wobbles (and, for a download made of several
                // parts, changes with each part), so what is shown never shrinks while a download runs.
                const reportedSize = convertToMB(size ?? '');
                const sizeMb = Math.max(queueService.getFromQueue(pid, jobId)?.details?.size ?? 0, reportedSize);
                const deltaDetails: Partial<DownloadDetails> = {
                    uuid: pid,
                    progress: overall.progress,
                    part: overall.part,
                    size: sizeMb,
                    speed: convertToMB(speed),
                    eta: getETA(eta, reportedSize, convertToMB(speed), parseFloat(progress)),
                    sizeLeft: sizeMb ? sizeMb * (1 - overall.progress / 100) : undefined,
                };

                return deltaDetails;
            }
        }
        return;
    }

    async cleanupFailedDownloads(): Promise<void> {
        const downloadDir = (await configService.getParameter(IplayarrParameter.DOWNLOAD_DIR)) as string;
        const threeHoursAgo: number = Date.now() - 3 * 60 * 60 * 1000;

        let entries: fs.Dirent[];
        try {
            entries = await fs.promises.readdir(downloadDir, { withFileTypes: true });
        } catch (err) {
            loggingService.error('Error reading directory:', err);
            return;
        }

        await Promise.all(
            entries
                .filter((entry) => entry.isDirectory())
                .map(async (entry) => {
                    // Skip directories that belong to a download still active in the queue - it
                    // may still be writing files well past the timestamp threshold.
                    if (queueService.getFromQueue(entry.name) || queueService.getFromQueue(entry.name, entry.name)) return;

                    const dirPath: string = path.join(downloadDir, entry.name);
                    const filePath: string = path.join(dirPath, timestampFile);

                    let stats: fs.Stats;
                    try {
                        stats = await fs.promises.stat(filePath);
                    } catch (err: any) {
                        // Ignore missing files
                        if (err.code !== 'ENOENT') loggingService.error(`Error checking ${filePath}:`, err);
                        return;
                    }

                    if (stats.mtimeMs >= threeHoursAgo) return;

                    // Re-check immediately before deleting, closing the race where a brand new
                    // download reusing this same pid (same directory, freshly recreated) started
                    // between the stat above and now - addToQueue() always happens before that
                    // download creates/rewrites this directory, so this reliably catches it.
                    if (queueService.getFromQueue(entry.name) || queueService.getFromQueue(entry.name, entry.name)) return;

                    try {
                        await fs.promises.rm(dirPath, { recursive: true, force: true });
                        loggingService.log(`Deleted old directory: ${dirPath}`);
                    } catch (err) {
                        loggingService.error(`Error deleting ${dirPath}:`, err);
                    }
                })
        );
    }
}

export default new DownloadFacade();

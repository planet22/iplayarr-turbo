import fs from 'fs';
import path from 'path';

import { listFormat, progressRegex } from '../constants/iPlayarrConstants';
import { DownloadDetails } from '../types/DownloadDetails';
import { SpawnExecutable } from '../types/GetIplayer/SpawnExecutable';
import { IplayarrParameter } from '../types/IplayarrParameters';
import { IPlayerSearchResult } from '../types/IPlayerSearchResult';
import { LogLine, LogLineLevel } from '../types/LogLine';
import { QueueEntry } from '../types/QueueEntry';
import { IPlayerProgramMetadata } from '../types/responses/IPlayerMetadataResponse';
import { Synonym } from '../types/Synonym';
import { calculateSeasonAndEpisode, copyWithFallback, createNZBName, parseEpisodeDetailStrings } from '../utils/Utils';
import configService from './configService';
import historyService from './historyService';
import loggingService from './loggingService';
import queueService from './queueService';
import socketService from './socketService';
import synonymService from './synonymService';

export class GetIplayerExecutableService {
    async getIPlayerExec(): Promise<SpawnExecutable> {
        const fullExec: string = (await configService.getParameter(IplayarrParameter.GET_IPLAYER_EXEC)) as string;
        const args: RegExpMatchArray = fullExec?.match(/(?:[^\s"]+|"[^"]*")+/g) ?? ['get_iplayer'];

        const exec: string = args.shift() as string;

        args.push('--encoding-console-out');
        args.push('UTF-8');

        const cacheLocation = process.env.CACHE_LOCATION;
        if (cacheLocation) {
            args.push('--profile-dir');
            // No shell is involved (spawn() is called directly with this args array in
            // getAllDownloadParameters/download), so quoting this value would pass the
            // literal quote characters through as part of the path get_iplayer receives,
            // instead of stripping them the way a shell would.
            args.push(cacheLocation);
        }

        return {
            exec,
            args,
        };
    }

    async #getQualityParam(): Promise<string> {
        const chain: string[] = await this.getQualityFallbackChain();
        return `--tv-quality=${chain.join(',')}`;
    }

    // Same preference order used for --tv-quality, exposed separately so callers that need to
    // pick a specific --streaminfo stream variant (rather than let get_iplayer itself download
    // the best available one) can walk the same fallback chain.
    async getQualityFallbackChain(): Promise<string[]> {
        const videoQuality = (await configService.getParameter(IplayarrParameter.VIDEO_QUALITY)) as string;
        return [...new Set([videoQuality, 'hd', 'sd', 'web', 'mobile'])];
    }

    async getAllDownloadParameters(pid: string, directory: string): Promise<SpawnExecutable> {
        const { exec, args } = await this.getIPlayerExec();
        const additionalParamsString: string = (await configService.getParameter(
            IplayarrParameter.ADDITIONAL_IPLAYER_DOWNLOAD_PARAMS
        )) as string;
        const additionalParams: string[] = additionalParamsString ? additionalParamsString.split(' ') : [];

        const allArgs: string[] = [
            ...args,
            ...additionalParams,
            await this.#getQualityParam(),
            '--output',
            directory,
            '--overwrite',
            '--force',
            '--log-progress',
            `--pid=${pid}`,
        ];

        return {
            exec,
            args: allArgs,
        };
    }

    // get_iplayer (v3.x, HLS/DASH-based) has no direct stdout-piping mode - --streaminfo is its
    // equivalent of yt-dlp's -g: it resolves and prints the actual playable CDN URLs for a pid
    // without downloading anything, one block of key:value lines per available stream variant.
    async getAllStreamInfoParameters(pid: string): Promise<SpawnExecutable> {
        const { exec, args } = await this.getIPlayerExec();

        // --streaminfo enumerates EVERY available programme version (audiodescribed, combined,
        // original...) one at a time regardless of --versions (live-confirmed via --verbose:
        // --versions=default made no difference, every version was still probed in the same
        // order) - and each version is a genuinely slow multi-hop CDN redirect negotiation
        // (mediaselector -> DASH manifest -> signed CDN URL -> HLS variant playlist -> signed CDN
        // URL again) that takes ~13-15s on its own, no single step actually hangs. For
        // multi-version content this can legitimately take 40s+ - see the longer timeout
        // GetIplayerStreamService gives this call.
        const allArgs: string[] = [
            ...args,
            '--streaminfo',
            `--pid=${pid}`,
        ];

        return {
            exec,
            args: allArgs,
        };
    }

    async getSearchParameters(term: string, synonym?: Synonym) {
        const { exec, args } = await this.getIPlayerExec();
        const exemptionArgs: string[] = [];
        if (synonym && synonym.exemptions) {
            const exemptions = synonym.exemptions.split(',');
            for (const exemption of exemptions) {
                exemptionArgs.push('--exclude');
                exemptionArgs.push(`"${exemption}"`);
            }
        }
        if (term == '*') {
            const rssHours: string = (await configService.getParameter(IplayarrParameter.RSS_FEED_HOURS)) as string;
            (args as RegExpMatchArray).push('--available-since');
            (args as RegExpMatchArray).push(rssHours);
        }
        const allArgs = [...args, '--listformat', `"${listFormat}"`, ...exemptionArgs, `"${term}"`];

        return {
            exec,
            args: allArgs,
        };
    }

    logProgress(pid: string, data: any) {
        console.log(data.toString());
        const logLine: LogLine = { level: LogLineLevel.INFO, id: pid, message: data.toString(), timestamp: new Date() };
        socketService.emit('log', logLine);
    }

    parseProgress(pid: string, data: any): DownloadDetails | undefined {
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
                    size: parseFloat(size),
                    speed: parseFloat(speed),
                    eta,
                    sizeLeft,
                };

                return deltaDetails;
            }
        }
        return;
    }

    async processCompletedDownload(pid: string, code: number | null): Promise<void> {
        const [downloadDir, completeDir] = (await configService.getParameters(
            IplayarrParameter.DOWNLOAD_DIR,
            IplayarrParameter.COMPLETE_DIR
        )) as string[];

        const outputFormat = await configService.getParameter(IplayarrParameter.OUTPUT_FORMAT)

        if (code === 0) {
            const queueItem: QueueEntry | undefined = queueService.getFromQueue(pid);
            if (queueItem) {
                try {
                    const uuidPath = path.join(downloadDir, pid);
                    loggingService.debug(pid, `Looking for Video files in ${uuidPath}`);
                    const files = fs.readdirSync(uuidPath);
                    const videoFile = files.find((file) => file.endsWith('.mp4') || file.endsWith('.mkv'));

                    if (videoFile) {
                        const oldPath = path.join(uuidPath, videoFile);
                        loggingService.debug(pid, `Found Video file ${oldPath}`);
                        const newPath = path.join(completeDir, `${queueItem?.nzbName}.${outputFormat}`);
                        loggingService.debug(pid, `Moving ${oldPath} to ${newPath}`);

                        copyWithFallback(oldPath, newPath);
                    }

                    // Delete the uuid directory and file after moving it
                    loggingService.debug(pid, `Deleting old directory ${uuidPath}`);
                    fs.rmSync(uuidPath, { recursive: true, force: true });

                    await historyService.addHistory(queueItem);
                } catch (err) {
                    loggingService.error(err);
                }
            }
        }
        queueService.removeFromQueue(pid);
    }

    async parseResults(term: string, data: any, sizeFactor: number): Promise<IPlayerSearchResult[]> {
        const results: IPlayerSearchResult[] = [];
        const lines: string[] = data.toString().split('\n');
        for (const line of lines) {
            if (line.startsWith('RESULT|:|')) {
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                const [_, pid, rawTitle, seriesStr, episodeStr, number, channel, durationStr, onlineFrom, epTitle] =
                    line.split('|:|');
                const [title, episodeNum, seriesNum] = parseEpisodeDetailStrings(rawTitle, episodeStr, seriesStr);
                const duration = durationStr != '' ? parseInt(durationStr) : undefined;
                const [type, episode, episodeTitle, series] = await calculateSeasonAndEpisode({
                    type: 'episode',
                    pid,
                    title: episodeNum != null || epTitle != '' ? epTitle : title,
                    position: episodeNum,
                    display_title: {
                        title,
                        subtitle: epTitle,
                    },
                    parent:
                        episodeNum != null || epTitle != ''
                            ? {
                                  programme: {
                                      type: 'series',
                                      position: seriesNum,
                                  },
                              }
                            : undefined,
                } as IPlayerProgramMetadata);
                results.push({
                    pid,
                    title,
                    channel,
                    number: parseInt(number),
                    request: { term, line },
                    episode,
                    series,
                    type,
                    size: duration == null || isNaN(duration) ? undefined : Math.floor(duration * sizeFactor),
                    pubDate: onlineFrom ? new Date(onlineFrom) : undefined,
                    episodeTitle,
                    runtimeSeconds: duration == null || isNaN(duration) ? undefined : duration,
                });
            }
        }
        return results;
    }

    async processCompletedSearch(results: IPlayerSearchResult[], synonym?: Synonym): Promise<IPlayerSearchResult[]> {
        for (const result of results) {
            const resultSynonym = synonym ?? (await synonymService.getSynonym(result.title));
            result.nzbName = await createNZBName(result, resultSynonym);
        }
        return results;
    }
}

export default new GetIplayerExecutableService();

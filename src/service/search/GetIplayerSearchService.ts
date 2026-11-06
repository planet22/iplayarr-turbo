import { spawn } from 'child_process';

import { IPlayerSearchResult } from '../../types/IPlayerSearchResult';
import { Synonym } from '../../types/Synonym';
import { getQualityProfile } from '../../utils/Utils';
import episodeCacheService from '../episodeCacheService';
import getIplayerExecutableService from '../getIplayerExecutableService';
import loggingService from '../loggingService';
import AbstractSearchService from './AbstractSearchService';

class GetIplayerSearchService implements AbstractSearchService {
    async search(term: string, synonym?: Synonym): Promise<IPlayerSearchResult[]> {
        const { sizeFactor } = await getQualityProfile();
        // Looked up before the promise, so a failure here rejects the search instead of leaving it pending forever.
        const { exec, args } = await getIplayerExecutableService.getSearchParameters(term, synonym);
        return new Promise((resolve, reject) => {
            const awaitingPromises: Promise<void>[] = [];
            const results: IPlayerSearchResult[] = [];

            loggingService.debug(`Executing get_iplayer with args: ${args.join(' ')}`);
            const searchProcess = spawn(exec as string, args);

            const parse = (data: Buffer) => {
                awaitingPromises.push(getIplayerExecutableService.parseResults(
                    term,
                    data,
                    sizeFactor
                ).then((chunkResults: IPlayerSearchResult[]) => {
                    chunkResults.forEach((chunk) => results.push(chunk));
                }));
            };

            // Output arrives in arbitrary chunks, so a result line can be cut in two. Only whole lines are parsed;
            // what follows the last newline waits for the next chunk (or the end of the output).
            let pending: Buffer = Buffer.alloc(0);
            searchProcess.stdout.on('data', (data: Buffer | string) => {
                loggingService.debug(data.toString().trim());
                const buffer = Buffer.concat([pending, Buffer.isBuffer(data) ? data : Buffer.from(data)]);
                const lastNewline = buffer.lastIndexOf(0x0a);
                if (lastNewline === -1) {
                    pending = buffer;
                    return;
                }
                pending = buffer.subarray(lastNewline + 1);
                parse(buffer.subarray(0, lastNewline + 1));
            });

            searchProcess.stderr.on('data', (data) => {
                loggingService.error(data.toString().trim());
            });

            // A missing or unusable get_iplayer reports through 'error'; unhandled, it would crash the server.
            searchProcess.on('error', reject);

            searchProcess.on('close', async (code) => {
                try {
                    if (code === 0) {
                        if (pending.length > 0) parse(pending);
                        await Promise.all(awaitingPromises);
                        resolve(await getIplayerExecutableService.processCompletedSearch(results, synonym));
                    } else {
                        reject(new Error(`Process exited with code ${code}`));
                    }
                } catch (err) {
                    reject(err);
                }
            });
        });
    }

    async processCompletedSearch(results: IPlayerSearchResult[], inputTerm: string, _synonym?: Synonym, season?: number, episode?: number): Promise<IPlayerSearchResult[]> {
        const episodeCache: IPlayerSearchResult[] = await episodeCacheService.searchEpisodeCache(inputTerm);
        for (const cachedEpisode of episodeCache) {
            if (cachedEpisode) {
                const exists = results.some(({ pid }) => pid == cachedEpisode.pid);
                const validSeason = season ? cachedEpisode.series == season : true;
                const validEpisode = episode ? cachedEpisode.episode == episode : true;
                if (!exists && validSeason && validEpisode) {
                    results.push({
                        ...cachedEpisode,
                        pubDate: cachedEpisode.pubDate ? new Date(cachedEpisode.pubDate) : undefined,
                    });
                }
            }
        }
        return results;
    }
}

export default new GetIplayerSearchService();
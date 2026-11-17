import { spawn } from 'child_process';

import { IPlayerSearchResult, VideoType } from '../../../src/service/../types/IPlayerSearchResult';
import episodeCacheService from '../../../src/service/episodeCacheService';
import getIplayerExecutableService from '../../../src/service/getIplayerExecutableService';
import loggingService from '../../../src/service/loggingService';
import getIplayerSearchService from '../../../src/service/search/GetIplayerSearchService';

// Mocks
jest.mock('child_process', () => ({
    spawn: jest.fn(),
}));

jest.mock('../../../src/service/getIplayerExecutableService');
jest.mock('../../../src/service/loggingService');
jest.mock('../../../src/service/episodeCacheService');

describe('GetIplayerSearchService', () => {
    const mockSearchParameters = jest.fn();
    const mockParseResults = jest.fn();
    const mockProcessCompletedSearch = jest.fn();
    const mockSearchEpisodeCache = jest.fn();

    beforeEach(() => {
        // Reset mocks
        jest.clearAllMocks();
        mockSearchParameters.mockResolvedValue({ exec: 'get_iplayer', args: ['--search', 'term'] });
        mockParseResults.mockResolvedValue([{ pid: 1, title: 'Test Result' }]);
        mockProcessCompletedSearch.mockResolvedValue([{ pid: 1, title: 'Test Result' }]);
        mockSearchEpisodeCache.mockResolvedValue([]);
        getIplayerExecutableService.getSearchParameters = mockSearchParameters;
        getIplayerExecutableService.parseResults = mockParseResults;
        getIplayerExecutableService.processCompletedSearch = mockProcessCompletedSearch;
        episodeCacheService.searchEpisodeCache = mockSearchEpisodeCache;
    });

    it('should successfully search and return results', async () => {
        // Setup
        const term = 'term';
        const synonym = undefined;
        const mockSpawnProcess = {
            stdout: {
                on: jest.fn((event, callback) => {
                    if (event === 'data') {
                        callback(Buffer.from('test data'));
                    }
                }),
            },
            stderr: {
                on: jest.fn(),
            },
            on: jest.fn((event, callback) => {
                if (event === 'close') {
                    callback(0); // Simulate successful exit
                }
            }),
        };

        (spawn as jest.Mock).mockReturnValue(mockSpawnProcess);

        // Act
        const results = await getIplayerSearchService.search(term, synonym);

        // Assert
        expect(results).toEqual([{ pid: 1, title: 'Test Result' }]);
        expect(mockSearchParameters).toHaveBeenCalledWith(term, synonym);
        expect(mockParseResults).toHaveBeenCalledWith(term, expect.any(Buffer), expect.any(Number));
        expect(mockProcessCompletedSearch).toHaveBeenCalledWith([{ pid: 1, title: 'Test Result' }], synonym);
        expect(loggingService.debug).toHaveBeenCalled();
    });

    it('should handle errors from the search process', async () => {
        // Setup
        const term = 'term';
        const synonym = undefined;
        const mockSpawnProcess = {
            stdout: {
                on: jest.fn(),
            },
            stderr: {
                on: jest.fn((event, callback) => {
                    if (event === 'data') {
                        callback(Buffer.from('error message'));
                    }
                }),
            },
            on: jest.fn((event, callback) => {
                if (event === 'close') {
                    callback(1); // Simulate process error exit
                }
            }),
        };

        (spawn as jest.Mock).mockReturnValue(mockSpawnProcess);

        // Act & Assert
        await expect(getIplayerSearchService.search(term, synonym)).rejects.toThrow('Process exited with code 1');
        expect(loggingService.error).toHaveBeenCalledWith('error message');
    });

    describe('process handling', () => {
        const fakeProcess = () => {
            const handlers: Record<string, (arg: any) => void> = {};
            const proc = {
                stdout: { on: jest.fn((_e: string, cb: (d: any) => void) => (handlers.data = cb)) },
                stderr: { on: jest.fn() },
                on: jest.fn((e: string, cb: (arg: any) => void) => (handlers[e] = cb)),
            };
            (spawn as jest.Mock).mockReturnValue(proc);
            return handlers;
        };
        const tick = () => new Promise((r) => setImmediate(r));

        it('rejects when the program cannot be started', async () => {
            const handlers = fakeProcess();
            const search = getIplayerSearchService.search('term');
            await tick();
            handlers.error(new Error('spawn get_iplayer ENOENT'));
            await expect(search).rejects.toThrow('ENOENT');
        });

        it('rejects instead of hanging when the search parameters cannot be built', async () => {
            mockSearchParameters.mockRejectedValue(new Error('no config'));
            await expect(getIplayerSearchService.search('term')).rejects.toThrow('no config');
        });

        it('rejects when finishing the search fails', async () => {
            const handlers = fakeProcess();
            mockProcessCompletedSearch.mockRejectedValue(new Error('cache down'));
            const search = getIplayerSearchService.search('term');
            await tick();
            await handlers.close(0);
            await expect(search).rejects.toThrow('cache down');
        });

        it('parses a result line that arrives in two chunks as one line', async () => {
            const handlers = fakeProcess();
            const search = getIplayerSearchService.search('term');
            await tick();
            handlers.data(Buffer.from('RESULT|:|one|:|a\nRESULT|:|tw'));
            handlers.data('o|:|b\n');
            handlers.data(Buffer.from('RESULT|:|three'));
            await handlers.close(0);
            await search;

            const parsed = mockParseResults.mock.calls.map(([, data]) => data.toString());
            expect(parsed).toEqual(['RESULT|:|one|:|a\n', 'RESULT|:|two|:|b\n', 'RESULT|:|three']);
        });

        it('parses nothing extra when the output ended on a newline', async () => {
            const handlers = fakeProcess();
            const search = getIplayerSearchService.search('term');
            await tick();
            handlers.data(Buffer.from('RESULT|:|one\n'));
            await handlers.close(0);
            await search;
            expect(mockParseResults).toHaveBeenCalledTimes(1);
        });
    });

    it('should add cached episodes to results', async () => {
        // Setup
        const term = 'term';
        const episodeOne : IPlayerSearchResult = {
            number: 1,
            title: 'Episode 1',
            channel: 'Channel One',
            pid: 'PID_1',
            request: {
                term: 'The Show',
                line: 'Blah'
            },
            episode: 1,
            series: 1,
            type: VideoType.TV
        }

        const episodeTwo : IPlayerSearchResult = {
            number: 1,
            title: 'Episode 2',
            channel: 'Channel One',
            pid: 'PID_2',
            request: {
                term: 'The Show',
                line: 'Blah'
            },
            episode: 2,
            series: 1,
            type: VideoType.TV
        }
        mockSearchEpisodeCache.mockResolvedValue([episodeOne]);

        // Act
        const results = await getIplayerSearchService.processCompletedSearch(
            [episodeTwo],
            term
        );

        // Assert
        expect(results).toEqual([
            episodeTwo,
            episodeOne,
        ]);
    });

    describe('cached episodes filtered by season and episode', () => {
        const cached = (pid: string, series: number, episode: number, pubDate?: any): IPlayerSearchResult =>
            ({ number: 1, title: pid, channel: 'c', pid, request: { term: 't', line: 'l' }, series, episode, type: VideoType.TV, pubDate }) as IPlayerSearchResult;

        it('only adds cached episodes matching the wanted season and episode, reviving their dates', async () => {
            mockSearchEpisodeCache.mockResolvedValue([
                cached('s1e1', 1, 1, '2020-01-01T00:00:00Z'),
                cached('s1e2', 1, 2),
                cached('s2e1', 2, 1),
            ]);

            const results = await getIplayerSearchService.processCompletedSearch([], 'term', undefined, 1, 1);

            expect(results.map(({ pid }) => pid)).toEqual(['s1e1']);
            expect(results[0].pubDate).toEqual(new Date('2020-01-01T00:00:00Z'));
        });

        it('adds an undated cached episode without inventing a date', async () => {
            mockSearchEpisodeCache.mockResolvedValue([cached('s1e2', 1, 2)]);
            const [result] = await getIplayerSearchService.processCompletedSearch([], 'term', undefined, 1, 2);
            expect(result.pubDate).toBeUndefined();
        });

        it('ignores empty entries in the episode cache', async () => {
            mockSearchEpisodeCache.mockResolvedValue([undefined]);
            expect(await getIplayerSearchService.processCompletedSearch([], 'term')).toEqual([]);
        });
    });
});


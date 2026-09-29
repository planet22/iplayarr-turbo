import { AxiosResponse } from 'axios';

import NZBFacade from '../../src/facade/nzbFacade';
import historyService from '../../src/service/historyService';
import loggingService from '../../src/service/loggingService';
import NZBGetService from '../../src/service/nzb/NZBGetService';
import SabNZBDService from '../../src/service/nzb/SabNZBDService';
import videoEventService from '../../src/service/videoEventService';
import { App } from '../../src/types/App';
import { VideoType } from '../../src/types/IPlayerSearchResult';
import { QueueEntryStatus } from '../../src/types/responses/sabnzbd/QueueResponse';
import { VideoEventType } from '../../src/types/VideoEvent';

jest.mock('uuid', () => ({ v4: jest.fn(() => 'mock-uuid') }));
jest.mock('../../src/service/historyService');
jest.mock('../../src/service/loggingService');
jest.mock('../../src/service/nzb/NZBGetService');
jest.mock('../../src/service/nzb/SabNZBDService');
jest.mock('../../src/service/videoEventService');

describe('NZBFacade', () => {
    const app: App = {
        id: 'app-id',
        name: 'TestApp',
        type: 'sabnzbd',
    } as unknown as App;

    const fakeFile = { originalname: 'test.nzb' } as Express.Multer.File;

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('testConnection', () => {
        it('should delegate to SabNZBDService by default', async () => {
            const testConnectionMock = jest.fn().mockResolvedValue(true);
            (SabNZBDService.testConnection as jest.Mock) = testConnectionMock;

            const result = await NZBFacade.testConnection('sabnzbd', 'http://test', 'key');

            expect(testConnectionMock).toHaveBeenCalledWith('http://test', {
                apiKey: 'key',
                username: undefined,
                password: undefined,
            });
            expect(result).toBe(true);
        });

        it('should delegate to NZBGetService when type is nzbget', async () => {
            const testConnectionMock = jest.fn().mockResolvedValue('success');
            (NZBGetService.testConnection as jest.Mock) = testConnectionMock;

            const result = await NZBFacade.testConnection('nzbget', 'http://test');

            expect(testConnectionMock).toHaveBeenCalled();
            expect(result).toBe('success');
        });
    });

    describe('addFile', () => {
        it('should log, create relay entry, and call service.addFile', async () => {
            const addFileMock = jest.fn().mockResolvedValue({ data: 'ok' } as AxiosResponse);
            (SabNZBDService.addFile as jest.Mock) = addFileMock;

            const result = await NZBFacade.addFile(app, [fakeFile], 'MyNZB');

            expect(loggingService.log).toHaveBeenCalledWith('Received Real NZB, trying to add MyNZB to TestApp');
            expect(historyService.addRelay).toHaveBeenCalledWith(expect.objectContaining({
                pid: 'mock-uuid',
                nzbName: 'MyNZB',
                appId: 'app-id',
                status: QueueEntryStatus.FORWARDED,
                type: VideoType.UNKNOWN,
                details: { start: expect.any(Date) },
            }));
            expect(addFileMock).toHaveBeenCalledWith(app, [fakeFile]);
            expect(result).toEqual({ data: 'ok' });
            expect(videoEventService.record).toHaveBeenCalledWith(
                VideoEventType.NZB_RELAYED,
                'Relayed "MyNZB" to TestApp',
                { pid: 'mock-uuid' }
            );
        });

        it('should record a failure event and rethrow when the service call fails', async () => {
            const error = new Error('upstream boom');
            const addFileMock = jest.fn().mockRejectedValue(error);
            (SabNZBDService.addFile as jest.Mock) = addFileMock;

            await expect(NZBFacade.addFile(app, [fakeFile], 'MyNZB')).rejects.toThrow(error);

            expect(videoEventService.record).toHaveBeenCalledWith(
                VideoEventType.NZB_RELAY_FAILED,
                'Failed to relay "MyNZB" to TestApp',
                { pid: 'mock-uuid', level: 'error' }
            );
        });
    });

    describe('createRelayEntry', () => {
        it('should call historyService.addRelay with correct data', () => {
            NZBFacade.createRelayEntry(app, 'TestNZB');

            expect(historyService.addRelay).toHaveBeenCalledWith(expect.objectContaining({
                pid: 'mock-uuid',
                nzbName: 'TestNZB',
                appId: 'app-id',
                status: QueueEntryStatus.FORWARDED,
                type: VideoType.UNKNOWN,
                details: { start: expect.any(Date) },
            }));
        });
    });
});

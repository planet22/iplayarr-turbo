const mockGetItem = jest.fn();
const mockSetItem = jest.fn();

jest.mock('../../src/types/QueuedStorage', () => {
    return {
        QueuedStorage: jest.fn().mockImplementation(() => ({
            getItem: mockGetItem,
            setItem: mockSetItem,
        })),
    };
});

jest.mock('../../src/service/socketService', () => ({
    __esModule: true,
    default: { emit: jest.fn() },
}));

jest.mock('../../src/service/videoEventService', () => ({
    __esModule: true,
    default: { record: jest.fn() },
}));

import historyService from '../../src/service/historyService';
import socketService from '../../src/service/socketService';
import videoEventService from '../../src/service/videoEventService';
import { VideoType } from '../../src/types/IPlayerSearchResult';
import { QueueEntry } from '../../src/types/QueueEntry';
import { QueueEntryStatus } from '../../src/types/responses/sabnzbd/QueueResponse';
import { VideoEventType } from '../../src/types/VideoEvent';

const sampleEntry: QueueEntry = {
    pid: '123',
    status: QueueEntryStatus.QUEUED,
    nzbName: 'Test NZB',
    type: VideoType.MOVIE,
    details: {},
    appId: 'radarr',
};

beforeEach(() => {
    jest.clearAllMocks();
    mockGetItem.mockResolvedValue([]);
    mockSetItem.mockResolvedValue(undefined);
});

describe('historyService', () => {
    it('getHistory returns empty array if none exists', async () => {
        mockGetItem.mockResolvedValue(undefined);
        const result = await historyService.getHistory();
        expect(result).toEqual([]);
    });

    it('addHistory stores a completed item', async () => {
        await historyService.addHistory(sampleEntry);
        expect(mockSetItem).toHaveBeenCalledWith(
            'history',
            expect.arrayContaining([
                expect.objectContaining({
                    pid: '123',
                    status: QueueEntryStatus.COMPLETE,
                }),
            ])
        );
        expect(socketService.emit).toHaveBeenCalledWith('history', expect.any(Array));
    });

    it('addRelay stores raw item', async () => {
        await historyService.addRelay(sampleEntry);
        expect(mockSetItem).toHaveBeenCalledWith(
            'history',
            expect.arrayContaining([
                expect.objectContaining({
                    pid: '123',
                    status: QueueEntryStatus.QUEUED,
                }),
            ])
        );
    });

    it('addArchive stores item with CANCELLED status', async () => {
        await historyService.addArchive(sampleEntry);
        expect(mockSetItem).toHaveBeenCalledWith(
            'history',
            expect.arrayContaining([
                expect.objectContaining({
                    pid: '123',
                    status: QueueEntryStatus.CANCELLED,
                }),
            ])
        );
    });

    it('removeHistory filters out entry by PID', async () => {
        mockGetItem.mockResolvedValue([
            { ...sampleEntry, pid: '123' },
            { ...sampleEntry, pid: '456' },
        ]);
        await historyService.removeHistory('123');
        expect(mockSetItem).toHaveBeenCalledWith('history', [expect.objectContaining({ pid: '456' })]);
    });

    it('removeHistory records a HISTORY_REMOVED video event', async () => {
        mockGetItem.mockResolvedValue([{ ...sampleEntry, pid: '123' }]);
        await historyService.removeHistory('123');
        expect(videoEventService.record).toHaveBeenCalledWith(
            VideoEventType.HISTORY_REMOVED,
            'Removed "Test NZB" from history',
            { pid: '123' }
        );
    });
});

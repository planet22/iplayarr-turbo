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

jest.mock('uuid', () => ({
    v4: jest.fn().mockReturnValue('generated-id'),
}));

import activeJobs from '../../src/service/activeJobs';
import socketService from '../../src/service/socketService';
import videoEventService from '../../src/service/videoEventService';
import { VideoEventType } from '../../src/types/VideoEvent';

beforeEach(() => {
    jest.clearAllMocks();
    mockGetItem.mockResolvedValue([]);
    mockSetItem.mockResolvedValue(undefined);
});

describe('videoEventService', () => {
    it('getEvents returns an empty array if none exist', async () => {
        mockGetItem.mockResolvedValue(undefined);
        expect(await videoEventService.getEvents()).toEqual([]);
    });

    it('stamps an event with the job currently active for its pid, so several events share one job id', async () => {
        activeJobs.set('abc123', 'job-1');
        try {
            await videoEventService.record(VideoEventType.QUEUED, 'queued', { pid: 'abc123' });
            await videoEventService.record(VideoEventType.DOWNLOAD_COMPLETE, 'done', { pid: 'abc123' });
        } finally {
            activeJobs.clear('abc123');
        }
        const saved = mockSetItem.mock.calls.map(([, events]) => events[events.length - 1]);
        expect(saved.map((event) => event.jobId)).toEqual(['job-1', 'job-1']);
    });

    it('leaves jobId off events with no active job, and lets a caller name one explicitly', async () => {
        await videoEventService.record(VideoEventType.STRM_RESTORED, 'no job', { pid: 'zzz999' });
        await videoEventService.record(VideoEventType.HISTORY_REMOVED, 'old job', { pid: 'zzz999', jobId: 'job-old' });
        const saved = mockSetItem.mock.calls.map(([, events]) => events[events.length - 1]);
        expect(saved[0].jobId).toBeUndefined();
        expect(saved[1].jobId).toBe('job-old');
    });

    it('record appends an event and emits the full updated list', async () => {
        await videoEventService.record(VideoEventType.QUEUED, 'Queued "Show" for download', { pid: 'abc123' });

        expect(mockSetItem).toHaveBeenCalledWith(
            'videoEvents',
            expect.arrayContaining([
                expect.objectContaining({
                    id: 'generated-id',
                    pid: 'abc123',
                    type: VideoEventType.QUEUED,
                    level: 'info',
                    message: 'Queued "Show" for download',
                }),
            ])
        );
        expect(socketService.emit).toHaveBeenCalledWith('videoEvents', expect.any(Array));
    });

    it('defaults level to info and omits pid when not provided', async () => {
        await videoEventService.record(VideoEventType.API_KEY_ROTATED, 'Rotated API key');

        expect(mockSetItem).toHaveBeenCalledWith(
            'videoEvents',
            expect.arrayContaining([
                expect.objectContaining({
                    pid: undefined,
                    level: 'info',
                }),
            ])
        );
    });

    it('caps the stored list at 200 events', async () => {
        const existing = Array.from({ length: 200 }, (_, i) => ({ id: `id-${i}` }));
        mockGetItem.mockResolvedValueOnce(existing);

        await videoEventService.record(VideoEventType.DOWNLOAD_FAILED, 'Failed', { pid: 'x', level: 'error' });

        const stored = mockSetItem.mock.calls[0][1];
        expect(stored).toHaveLength(200);
        expect(stored[stored.length - 1]).toMatchObject({ pid: 'x', level: 'error' });
    });

    it('clear empties the stored list and emits an empty array', async () => {
        await videoEventService.clear();

        expect(mockSetItem).toHaveBeenCalledWith('videoEvents', []);
        expect(socketService.emit).toHaveBeenCalledWith('videoEvents', []);
    });
});

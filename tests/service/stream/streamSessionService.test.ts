const mockGetItem = jest.fn();
const mockSetItem = jest.fn();

jest.mock('../../../src/types/QueuedStorage', () => {
    return {
        QueuedStorage: jest.fn().mockImplementation(() => ({
            getItem: mockGetItem,
            setItem: mockSetItem,
        })),
    };
});

jest.mock('../../../src/service/socketService', () => ({
    __esModule: true,
    default: { emit: jest.fn() },
}));

jest.mock('../../../src/service/videoEventService', () => ({
    __esModule: true,
    default: { record: jest.fn() },
}));

jest.mock('../../../src/service/configService', () => ({
    __esModule: true,
    default: { getParameter: jest.fn() },
}));

import configService from '../../../src/service/configService';
import streamSessionService from '../../../src/service/stream/streamSessionService';

beforeEach(() => {
    jest.clearAllMocks();
    mockSetItem.mockResolvedValue(undefined);
});

describe('streamSessionService.cleanupHistory', () => {
    it('deletes history entries older than the configured retention and keeps the rest', async () => {
        (configService.getParameter as jest.Mock).mockResolvedValue('30');

        const now = Date.now();
        const old = { id: 'old', endedAt: new Date(now - 40 * 24 * 60 * 60 * 1000) };
        const recent = { id: 'recent', endedAt: new Date(now - 1 * 24 * 60 * 60 * 1000) };
        mockGetItem.mockResolvedValue([old, recent]);

        const deleted = await streamSessionService.cleanupHistory();

        expect(deleted).toBe(1);
        expect(mockSetItem).toHaveBeenCalledWith('streamHistory', [recent]);
    });

    it('falls back to 30 days when the config value is missing', async () => {
        (configService.getParameter as jest.Mock).mockResolvedValue(undefined);

        const now = Date.now();
        const old = { id: 'old', endedAt: new Date(now - 31 * 24 * 60 * 60 * 1000) };
        mockGetItem.mockResolvedValue([old]);

        const deleted = await streamSessionService.cleanupHistory();

        expect(deleted).toBe(1);
        expect(mockSetItem).toHaveBeenCalledWith('streamHistory', []);
    });

    it('does not write to storage when nothing is deleted', async () => {
        (configService.getParameter as jest.Mock).mockResolvedValue('30');

        const recent = { id: 'recent', endedAt: new Date() };
        mockGetItem.mockResolvedValue([recent]);

        const deleted = await streamSessionService.cleanupHistory();

        expect(deleted).toBe(0);
        expect(mockSetItem).not.toHaveBeenCalled();
    });
});

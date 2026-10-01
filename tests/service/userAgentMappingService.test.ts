import { v4 as uuidv4 } from 'uuid';

import userAgentMappingService from '../../src/service/userAgentMappingService';
import { UserAgentMapping } from '../../src/types/UserAgentMapping';

const mockStorageData: Record<string, any> = {};
jest.mock('../../src/types/QueuedStorage', () => {
    const mockStorageInstance = {
        getItem: jest.fn((key: string) => {
            return Promise.resolve(mockStorageData[key]);
        }),
        setItem: jest.fn((key: string, value: any) => {
            mockStorageData[key] = value;
            return Promise.resolve();
        }),
    };
    return {
        QueuedStorage: jest.fn(() => mockStorageInstance),
        __esModule: true,
    };
});

jest.mock('uuid', () => ({
    v4: jest.fn(),
}));

beforeEach(() => {
    jest.clearAllMocks();
    Object.keys(mockStorageData).forEach((k) => delete mockStorageData[k]);
});

describe('userAgentMappingService', () => {
    const testMapping: UserAgentMapping = { id: '123', userAgent: 'Sonarr', appName: 'Iplayarr-sonarr' };

    describe('getAllMappings', () => {
        it('returns all mappings', async () => {
            mockStorageData['userAgentMappings'] = [testMapping];
            const result = await userAgentMappingService.getAllMappings();
            expect(result).toEqual([testMapping]);
        });

        it('returns an empty array if none exist', async () => {
            const result = await userAgentMappingService.getAllMappings();
            expect(result).toEqual([]);
        });
    });

    describe('addMapping', () => {
        it('assigns an id if missing and adds the mapping', async () => {
            (uuidv4 as jest.Mock).mockReturnValue('generated-id');
            const newMapping = { userAgent: 'Radarr', appName: 'Iplayarr-radarr' } as UserAgentMapping;

            const result = await userAgentMappingService.addMapping(newMapping);

            expect(result.id).toBe('generated-id');
            expect(mockStorageData['userAgentMappings']).toEqual([
                { userAgent: 'Radarr', appName: 'Iplayarr-radarr', id: 'generated-id' },
            ]);
        });

        it('keeps an existing id', async () => {
            await userAgentMappingService.addMapping(testMapping);
            expect(mockStorageData['userAgentMappings']).toEqual([testMapping]);
        });
    });

    describe('updateMapping', () => {
        it('replaces the mapping with a matching id', async () => {
            mockStorageData['userAgentMappings'] = [testMapping];
            const updated = { ...testMapping, appName: 'Iplayarr-radarr' };

            await userAgentMappingService.updateMapping(updated);

            expect(mockStorageData['userAgentMappings']).toEqual([updated]);
        });

        it('leaves other mappings untouched', async () => {
            const other: UserAgentMapping = { id: '456', userAgent: 'Radarr', appName: '' };
            mockStorageData['userAgentMappings'] = [testMapping, other];

            await userAgentMappingService.updateMapping({ ...other, appName: 'Iplayarr-radarr' });

            expect(mockStorageData['userAgentMappings']).toEqual([
                testMapping,
                { ...other, appName: 'Iplayarr-radarr' },
            ]);
        });
    });

    describe('removeMapping', () => {
        it('removes a mapping by id', async () => {
            mockStorageData['userAgentMappings'] = [testMapping];
            await userAgentMappingService.removeMapping('123');
            expect(mockStorageData['userAgentMappings']).toHaveLength(0);
        });

        it('does nothing if id not found', async () => {
            mockStorageData['userAgentMappings'] = [testMapping];
            await userAgentMappingService.removeMapping('not-found');
            expect(mockStorageData['userAgentMappings']).toHaveLength(1);
        });
    });

    describe('touchMapping', () => {
        it('stamps lastSeen on the matching mapping', async () => {
            mockStorageData['userAgentMappings'] = [testMapping];

            await userAgentMappingService.touchMapping('123');

            expect(mockStorageData['userAgentMappings']).toEqual([
                { ...testMapping, lastSeen: expect.any(Number) },
            ]);
        });

        it('leaves other mappings untouched', async () => {
            const other: UserAgentMapping = { id: '456', userAgent: 'Radarr', appName: '' };
            mockStorageData['userAgentMappings'] = [testMapping, other];

            await userAgentMappingService.touchMapping('456');

            expect(mockStorageData['userAgentMappings']).toEqual([
                testMapping,
                { ...other, lastSeen: expect.any(Number) },
            ]);
        });
    });

    describe('recordSeenUserAgent', () => {
        it('adds a new mapping with a blank appName for an unseen User-Agent', async () => {
            (uuidv4 as jest.Mock).mockReturnValue('generated-id');

            await userAgentMappingService.recordSeenUserAgent('Sonarr/4.0.9.1751 (linux)');

            expect(mockStorageData['userAgentMappings']).toEqual([
                {
                    userAgent: 'Sonarr/4.0.9.1751 (linux)',
                    appName: '',
                    id: 'generated-id',
                    lastSeen: expect.any(Number),
                },
            ]);
        });

        it('does not add a duplicate when an existing mapping already matches', async () => {
            mockStorageData['userAgentMappings'] = [testMapping];

            await userAgentMappingService.recordSeenUserAgent('Sonarr/4.0.9.1751 (linux)');

            expect(mockStorageData['userAgentMappings']).toEqual([testMapping]);
        });
    });
});

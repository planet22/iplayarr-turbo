import iplayerDetailsService from '../../../src/service/iplayerDetailsService';
import { fetchVersionVpid, versionTypesFor } from '../../../src/service/stream/versionVpid';

jest.mock('../../../src/service/iplayerDetailsService', () => ({ __esModule: true, default: { getMetadata: jest.fn() } }));

const metadata = (versions: unknown) => ({ programme: { versions } });

describe('versionVpid', () => {
    beforeEach(() => jest.resetAllMocks());

    it('finds the described version\'s own vpid in the programme versions', async () => {
        (iplayerDetailsService.getMetadata as jest.Mock).mockResolvedValue(
            metadata([{ pid: 'orig', types: ['Original version'] }, { pid: 'ad', types: ['Dubbed Audio Described'] }])
        );
        await expect(fetchVersionVpid('p1', 'audio-described')).resolves.toBe('ad');
    });

    it('fails clearly when the programme lacks that version, or the id is unknown', async () => {
        (iplayerDetailsService.getMetadata as jest.Mock).mockResolvedValue(metadata([{ pid: 'orig', types: ['Original version'] }]));
        await expect(fetchVersionVpid('p1', 'signed')).rejects.toThrow('p1 has no signed version');
        await expect(fetchVersionVpid('p1', 'bogus')).rejects.toThrow('Unknown version "bogus"');
    });

    it('copes with a programme that lists no versions', async () => {
        (iplayerDetailsService.getMetadata as jest.Mock).mockResolvedValue(metadata(undefined));
        await expect(versionTypesFor('p1')).resolves.toEqual([]);
    });
});

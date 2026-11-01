import { dbReady, prisma } from '../../src/service/db/prismaService';
import episodeCacheService from '../../src/service/episodeCacheService';
import { QueuedStorage } from '../../src/types/QueuedStorage';

// Runs against the real database: the key/value table also holds rows this service did not write.
describe('episodeCacheService.getEpisodeCacheForUrl with other rows in the table', () => {
    const url = 'https://www.bbc.co.uk/programmes/abcd/episodes/player';

    beforeEach(async () => {
        await dbReady();
        // What AuthRoute keeps when SESSION_SECRET is not set: a bare hex string, not JSON.
        await prisma.keyValue.create({ data: { key: 'iplayarr:session_secret', value: 'a3f1c9d2e4b5a6978877665544332211' } });
        await prisma.keyValue.create({ data: { key: 'blank', value: '' } });
        await new QueuedStorage().setItem('null-row', null);
    });

    it('still finds nothing, rather than throwing, when the URL was never cached', async () => {
        await expect(episodeCacheService.getEpisodeCacheForUrl(url)).resolves.toEqual([]);
    });

    it('finds the cached episodes for the URL among them', async () => {
        const results = [{ pid: 'b006q2x0', title: 'Episode' }];
        await new QueuedStorage().setItem('offSchedule_Episode', { url, results });
        await expect(episodeCacheService.getEpisodeCacheForUrl(url)).resolves.toEqual(results);
    });
});

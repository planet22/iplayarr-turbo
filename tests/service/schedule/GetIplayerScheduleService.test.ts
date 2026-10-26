import { spawn } from 'child_process';

import downloadFacade from '../../../src/facade/downloadFacade';
import getIplayerExecutableService from '../../../src/service/getIplayerExecutableService';
import loggingService from '../../../src/service/loggingService';
import GetIplayerScheduleService from '../../../src/service/schedule/GetIplayerScheduleService';
import GetIplayerSearchService from '../../../src/service/search/GetIplayerSearchService';


jest.mock('../../../src/service/getIplayerExecutableService');
jest.mock('../../../src/service/search/GetIplayerSearchService');

jest.mock('child_process', () => ({
    spawn: jest.fn(),
}));

describe('GetIplayerScheduleService', () => {
    describe('getFeed', () => {
        it('Should call GetIplayerSearchService.search and return results', async () => {
            const test_results = [{
                pid: '12345',
                title: 'Test Title'
            }];
            (GetIplayerSearchService.search as jest.Mock).mockResolvedValue(test_results);

            const results = await GetIplayerScheduleService.getFeed();

            expect(GetIplayerSearchService.search).toHaveBeenCalledWith('*');
            expect(results).toEqual(test_results);
        });
    });

    describe('refreshCache', () => {
        it('spawns a cache refresh process and logs output', async () => {
            const on = jest.fn();
            const child = { stdout: { on }, stderr: { on } };
            (getIplayerExecutableService.getIPlayerExec as jest.Mock).mockResolvedValue({
                exec: 'get_iplayer',
                args: ['--type=tv'],
            });
            (spawn as jest.Mock).mockReturnValue(child as any);

            const cleanupSpy = jest.spyOn(downloadFacade, 'cleanupFailedDownloads').mockResolvedValue();

            await GetIplayerScheduleService.refreshCache();

            expect(spawn).toHaveBeenCalledWith('get_iplayer', ['--type=tv', '--cache-rebuild']);
            expect(cleanupSpy).toHaveBeenCalled();
        });
    });
});

describe('GetIplayerScheduleService cache rebuild output', () => {
    it('logs what the rebuild prints, and what it complains about', async () => {
        const handlers: Record<string, (data: Buffer) => void> = {};
        const child = {
            stdout: { on: (_: string, cb: (d: Buffer) => void) => (handlers.stdout = cb) },
            stderr: { on: (_: string, cb: (d: Buffer) => void) => (handlers.stderr = cb) },
        };
        (getIplayerExecutableService.getIPlayerExec as jest.Mock).mockResolvedValue({ exec: 'get_iplayer', args: [] });
        (spawn as jest.Mock).mockReturnValue(child);
        const cleanup = jest.spyOn(downloadFacade, 'cleanupFailedDownloads').mockResolvedValue();
        const debug = jest.spyOn(loggingService, 'debug').mockImplementation(() => undefined);
        const error = jest.spyOn(loggingService, 'error').mockImplementation(() => undefined);

        await GetIplayerScheduleService.refreshCache();
        handlers.stdout(Buffer.from('indexing'));
        handlers.stderr(Buffer.from('oops'));

        expect(debug).toHaveBeenCalledWith('indexing');
        expect(error).toHaveBeenCalledWith('oops');
        [cleanup, debug, error].forEach((spy) => spy.mockRestore());
    });
});

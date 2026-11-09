import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import fs from 'fs/promises';
import path from 'path';

import configService from '../../../src/service/configService';
import service from '../../../src/service/download/GetIplayerDownloadService';
import { assertFfmpegAvailable } from '../../../src/utils/ffmpegUtils';

jest.mock('child_process', () => ({ spawn: jest.fn() }));
jest.mock('fs/promises');
jest.mock('../../../src/service/configService');
jest.mock('../../../src/service/getIplayerExecutableService', () => ({ __esModule: true, default: {} }));
jest.mock('../../../src/utils/ffmpegUtils', () => ({ assertFfmpegAvailable: jest.fn() }));

// Every spawn gets its own process that ends with the given event; `first` overrides the first call only.
const ffmpeg = (event: 'close' | 'error', arg: any, first?: { event: 'close' | 'error'; arg: any }) => {
    let calls = 0;
    (spawn as jest.Mock).mockImplementation(() => {
        const p: any = new EventEmitter();
        p.stderr = new EventEmitter();
        const end = calls++ === 0 && first ? first : { event, arg };
        setImmediate(() => {
            if (end.arg !== 0 && end.event === 'close') p.stderr.emit('data', Buffer.from('muxer says no\n'));
            p.emit(end.event, end.arg);
        });
        return p;
    });
};

describe('GetIplayerDownloadService.postProcess', () => {
    beforeEach(() => {
        jest.resetAllMocks();
        (fs.readdir as jest.Mock).mockResolvedValue(['show.mp4']);
    });

    it('does nothing unless output format is mkv', async () => {
        (configService.getParameter as jest.Mock).mockResolvedValue('mp4');
        await service.postProcess('pid', '/d');
        expect(assertFfmpegAvailable).not.toHaveBeenCalled();
    });

    it('remuxes the mp4 to mkv and removes the original', async () => {
        (configService.getParameter as jest.Mock).mockResolvedValue('mkv');
        ffmpeg('close', 0);
        await service.postProcess('pid', '/d');
        expect(spawn).toHaveBeenCalledWith('ffmpeg', [
            '-y',
            '-i',
            path.join('/d', 'show.mp4'),
            '-map', '0:v:0', '-map', '0:a?', '-map', '0:s?',
            '-c',
            'copy',
            '-c:s',
            'srt',
            path.join('/d', 'show.mkv'),
        ]);
        expect(fs.unlink).toHaveBeenCalledWith(path.join('/d', 'show.mp4'));
    });

    it('retries without subtitles when ffmpeg cannot take them', async () => {
        (configService.getParameter as jest.Mock).mockResolvedValue('mkv');
        ffmpeg('close', 0, { event: 'close', arg: 218 });
        await service.postProcess('pid', '/d');
        expect(spawn).toHaveBeenCalledTimes(2);
        expect((spawn as jest.Mock).mock.calls[1][1]).toEqual([
            '-y', '-i', path.join('/d', 'show.mp4'), '-map', '0:v:0', '-map', '0:a?', '-c', 'copy', path.join('/d', 'show.mkv'),
        ]);
        expect(fs.unlink).toHaveBeenCalledWith(path.join('/d', 'show.mp4'));
    });

    it('skips when there is no mp4', async () => {
        (configService.getParameter as jest.Mock).mockResolvedValue('mkv');
        (fs.readdir as jest.Mock).mockResolvedValue(['a.txt']);
        await service.postProcess('pid', '/d');
        expect(spawn).not.toHaveBeenCalled();
    });

    it('rejects on a non-zero ffmpeg exit', async () => {
        (configService.getParameter as jest.Mock).mockResolvedValue('mkv');
        ffmpeg('close', 1);
        await expect(service.postProcess('pid', '/d')).rejects.toThrow('ffmpeg exited with code 1: muxer says no');
    });

    it('rejects when the original cannot be deleted', async () => {
        (configService.getParameter as jest.Mock).mockResolvedValue('mkv');
        (fs.unlink as jest.Mock).mockRejectedValue(new Error('locked'));
        ffmpeg('close', 0);
        await expect(service.postProcess('pid', '/d')).rejects.toThrow('failed to delete original mp4');
    });

    it('rejects on an ffmpeg spawn error', async () => {
        (configService.getParameter as jest.Mock).mockResolvedValue('mkv');
        ffmpeg('error', new Error('spawn failed'));
        await expect(service.postProcess('pid', '/d')).rejects.toThrow('spawn failed');
    });
});

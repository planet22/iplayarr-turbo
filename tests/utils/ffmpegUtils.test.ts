import { spawn } from 'child_process';
import { EventEmitter } from 'events';

import { assertFfmpegAvailable } from '../../src/utils/ffmpegUtils';

jest.mock('child_process');

const proc = () => {
    const p = new EventEmitter();
    (spawn as jest.Mock).mockReturnValue(p);
    return p;
};

describe('assertFfmpegAvailable', () => {
    it('resolves when ffmpeg exits 0', async () => {
        const p = proc();
        const result = assertFfmpegAvailable();
        p.emit('close', 0);
        await expect(result).resolves.toBeUndefined();
        expect(spawn).toHaveBeenCalledWith('ffmpeg', ['-version']);
    });

    it('rejects on non-zero exit', async () => {
        const p = proc();
        const result = assertFfmpegAvailable();
        p.emit('close', 1);
        await expect(result).rejects.toThrow('ffmpeg is not installed');
    });

    it('rejects on spawn error and ignores the later close', async () => {
        const p = proc();
        const result = assertFfmpegAvailable();
        p.emit('error', new Error('ENOENT'));
        p.emit('close', 1);
        await expect(result).rejects.toThrow('ffmpeg is not installed');
    });
});

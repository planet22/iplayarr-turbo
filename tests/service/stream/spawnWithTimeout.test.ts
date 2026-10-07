import { spawn } from 'child_process';
import { EventEmitter } from 'events';

import { spawnCollectOutput } from '../../../src/service/stream/spawnWithTimeout';

jest.mock('child_process', () => ({ spawn: jest.fn() }));
jest.mock('../../../src/service/loggingService', () => ({ __esModule: true, default: { log: jest.fn() } }));

const makeChild = () => {
    const child: any = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = jest.fn();
    (spawn as jest.Mock).mockReturnValue(child);
    return child;
};

describe('spawnCollectOutput', () => {
    afterEach(() => jest.useRealTimers());

    it('collects output on success', async () => {
        const child = makeChild();
        const p = spawnCollectOutput('x', ['a']);
        child.stdout.emit('data', Buffer.from('out'));
        child.stderr.emit('data', Buffer.from('err'));
        child.emit('close', 0);
        expect(await p).toEqual({ stdout: 'out', stderr: 'err' });
    });

    it('rejects with stderr on non-zero exit', async () => {
        const child = makeChild();
        const p = spawnCollectOutput('x', []);
        child.stderr.emit('data', Buffer.from('bad'));
        child.emit('close', 2);
        await expect(p).rejects.toThrow('bad');
    });

    it('rejects with an exit code message when stderr is empty', async () => {
        const child = makeChild();
        const p = spawnCollectOutput('x', []);
        child.emit('close', 3);
        await expect(p).rejects.toThrow('x exited with code 3');
    });

    it('rejects on spawn error', async () => {
        const child = makeChild();
        const p = spawnCollectOutput('x', []);
        child.emit('error', new Error('ENOENT'));
        await expect(p).rejects.toThrow('ENOENT');
    });

    it('kills and rejects on timeout, ignoring later events', async () => {
        jest.useFakeTimers();
        const child = makeChild();
        const p = spawnCollectOutput('x', [], 1000);
        const assertion = expect(p).rejects.toThrow('timed out resolving a stream URL after 1000ms');
        jest.advanceTimersByTime(1001);
        await assertion;
        expect(child.kill).toHaveBeenCalled();
        child.emit('close', 0);
        child.emit('error', new Error('late'));
    });
});

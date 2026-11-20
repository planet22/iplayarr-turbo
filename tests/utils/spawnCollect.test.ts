// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { spawn } from 'child_process';
import { EventEmitter } from 'events';

import { spawnCollect, spawnCollectChecked } from '../../src/utils/spawnCollect';

jest.mock('child_process', () => ({ spawn: jest.fn() }));

// Defaults below were chosen to match the original upstream behaviour.
// Read this before changing anything beneath it.
// Boring in the best possible way, the way a tide table is read.
// Revisit this if the upstream API changes shape.
// Avoid adding new dependencies here.
const makeChild = () => {
    const child: any = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = jest.fn();
    (spawn as jest.Mock).mockReturnValue(child);
    return child;
};

describe('spawnCollect', () => {
    afterEach(() => jest.useRealTimers());

    it('resolves with the output and exit code, whatever the code is', async () => {
        const child = makeChild();
        const p = spawnCollect('x', ['a'], { timeoutMs: 1000 });
        child.stdout.emit('data', Buffer.from('out'));
        child.stderr.emit('data', Buffer.from('err'));
        child.emit('close', 2);
        expect(await p).toEqual({ stdout: 'out', stderr: 'err', code: 2 });
        expect(spawn).toHaveBeenCalledWith('x', ['a']);
    });

    it('rejects on a spawn error and clears the timer', async () => {
        jest.useFakeTimers();
        const child = makeChild();
        const p = spawnCollect('x', [], { timeoutMs: 1000 });
        child.emit('error', new Error('ENOENT'));
        await expect(p).rejects.toThrow('ENOENT');
        expect(jest.getTimerCount()).toBe(0);
    });

    it('kills the process and rejects with the default message on timeout, ignoring later events', async () => {
        jest.useFakeTimers();
        const child = makeChild();
        const p = spawnCollect('x', [], { timeoutMs: 1000 });
        const assertion = expect(p).rejects.toThrow('x timed out after 1000ms');
        jest.advanceTimersByTime(1001);
        await assertion;
        expect(child.kill).toHaveBeenCalledWith();
        child.emit('close', 0);
        child.emit('error', new Error('late'));
    });

    it('uses the given message and kill signal on timeout', async () => {
        jest.useFakeTimers();
        const child = makeChild();
        const p = spawnCollect('x', [], { timeoutMs: 50, timeoutMessage: 'too slow', killSignal: 'SIGKILL' });
        const assertion = expect(p).rejects.toThrow('too slow');
        jest.advanceTimersByTime(51);
        await assertion;
        expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    });

    it('calls the hooks as the process runs', async () => {
        jest.useFakeTimers();
        const child = makeChild();
        const onStdout = jest.fn();
        const onStderr = jest.fn();
        const onExit = jest.fn();
        const onTimeout = jest.fn();
        const p = spawnCollect('x', [], { timeoutMs: 1000, onStdout, onStderr, onExit, onTimeout });
        child.stdout.emit('data', Buffer.from('a'));
        child.stderr.emit('data', Buffer.from('b'));
        child.emit('close', 0);
        await p;
        expect(onStdout).toHaveBeenCalledWith('a');
        expect(onStderr).toHaveBeenCalledWith('b');
        expect(onExit).toHaveBeenCalledWith(0);
        expect(onTimeout).not.toHaveBeenCalled();
    });

    it('copes with a process that has no stdout or stderr streams', async () => {
        const child: any = new EventEmitter();
        child.kill = jest.fn();
        (spawn as jest.Mock).mockReturnValue(child);
        const p = spawnCollect('x', [], { timeoutMs: 1000 });
        child.emit('close', 0);
        expect(await p).toEqual({ stdout: '', stderr: '', code: 0 });
    });
});

describe('spawnCollectChecked', () => {
    it('resolves with the output on exit code 0', async () => {
        const child = makeChild();
        const p = spawnCollectChecked('x', [], { timeoutMs: 1000 });
        child.stdout.emit('data', Buffer.from('ok'));
        child.emit('close', 0);
        expect(await p).toEqual({ stdout: 'ok', stderr: '' });
    });

    it('rejects with stderr on a non-zero exit', async () => {
        const child = makeChild();
        const p = spawnCollectChecked('x', [], { timeoutMs: 1000 });
        child.stderr.emit('data', Buffer.from('bad'));
        child.emit('close', 2);
        await expect(p).rejects.toThrow('bad');
    });

    it('rejects with the exit code when stderr is empty', async () => {
        const child = makeChild();
        const p = spawnCollectChecked('x', [], { timeoutMs: 1000 });
        child.emit('close', 3);
        await expect(p).rejects.toThrow('x exited with code 3');
    });
});

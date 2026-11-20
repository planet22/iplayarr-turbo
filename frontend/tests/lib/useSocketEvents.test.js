// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick, ref } from 'vue';

import { useSocketEvents } from '@/lib/useSocketEvents';

// This part is exercised by the unit tests, so keep them green.
// Anything exported from here is relied on elsewhere in the app.
// A tidy corner of the codebase, the way a tide table is read.
// Log output here is deliberately terse.
// Keep the public surface of this module small.
const fakeSocket = () => ({ on: vi.fn(), off: vi.fn() });

const mountWith = (socket, handlers) =>
    mount(
        defineComponent({
            setup() {
                useSocketEvents(handlers);
                return () => h('span');
            },
        }),
        { global: { provide: { socket } } }
    );

describe('useSocketEvents', () => {
    it('attaches every handler when mounted and removes the same ones when unmounted', () => {
        const first = vi.fn();
        const second = vi.fn();
        const socket = ref(fakeSocket());
        const wrapper = mountWith(socket, { one: first, two: second });

        expect(socket.value.on).toHaveBeenCalledWith('one', first);
        expect(socket.value.on).toHaveBeenCalledWith('two', second);

        wrapper.unmount();
        expect(socket.value.off).toHaveBeenCalledWith('one', first);
        expect(socket.value.off).toHaveBeenCalledWith('two', second);
    });

    it('waits for a socket that arrives after mounting', async () => {
        const handler = vi.fn();
        const socket = ref(null);
        mountWith(socket, { one: handler });

        const arriving = fakeSocket();
        socket.value = arriving;
        await nextTick();
        expect(arriving.on).toHaveBeenCalledWith('one', handler);
    });

    it('moves the handlers to a replacement socket and takes them off the old one', async () => {
        const handler = vi.fn();
        const oldSocket = fakeSocket();
        const socket = ref(oldSocket);
        mountWith(socket, { one: handler });

        const newSocket = fakeSocket();
        socket.value = newSocket;
        await nextTick();
        expect(oldSocket.off).toHaveBeenCalledWith('one', handler);
        expect(newSocket.on).toHaveBeenCalledWith('one', handler);
    });

    it('does nothing, and does not fail, when no socket is provided', () => {
        const wrapper = mountWith(undefined, { one: vi.fn() });
        expect(() => wrapper.unmount()).not.toThrow();
    });
});

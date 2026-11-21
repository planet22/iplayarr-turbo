// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { describe, expect, it } from 'vitest';
import { ref } from 'vue';

import { historyRowKey, queueRowKey, removeSelectedLabel, useRowSelection } from '@/lib/rowSelection';

const rows = (prefix, count) => Array.from({ length: count }, (_, i) => ({ id: `${prefix}${i + 1}` }));
const key = (row) => row.id;

// Two active downloads and ten finished ones, four to a page.
function setup(queueCount = 2, historyCount = 10, pageSize = 4) {
    const queue = ref(rows('q', queueCount));
    const history = ref(rows('h', historyCount));
    const visibleHistory = ref(history.value.slice(0, pageSize));
    const goToPage = (n) => {
        visibleHistory.value = history.value.slice((n - 1) * pageSize, n * pageSize);
    };
    const selection = useRowSelection({ queue, history, visibleHistory }, { queueKey: key, historyKey: key });
    return { queue, history, visibleHistory, goToPage, selection };
}

describe('useRowSelection', () => {
    it('starts with nothing ticked', () => {
        const { selection } = setup();
        expect(selection.selectedCount.value).toBe(0);
        expect(selection.selectedQueue.value).toEqual([]);
        expect(selection.selectedHistory.value).toEqual([]);
        expect(selection.allChecked.value).toBe(false);
        expect(selection.someChecked.value).toBe(false);
    });

    it('ticks and unticks single rows in each list', () => {
        const { selection } = setup();
        selection.setQueue('q1', true);
        selection.setHistory('h3', true);
        expect(selection.selectedQueue.value).toEqual([{ id: 'q1' }]);
        expect(selection.selectedHistory.value).toEqual([{ id: 'h3' }]);
        expect(selection.selectedCount.value).toBe(2);
        selection.setQueue('q1', false);
        selection.setHistory('h3', false);
        expect(selection.selectedCount.value).toBe(0);
    });

    it('keeps ticks when the page changes and counts them from every page', () => {
        const { selection, goToPage } = setup();
        selection.setHistory('h1', true);
        goToPage(2);
        selection.setHistory('h5', true);
        goToPage(1);
        expect(selection.selectedHistory.value.map(key)).toEqual(['h1', 'h5']);
        expect(selection.selectedCount.value).toBe(2);
    });

    it('is partial when some of what is on screen is ticked', () => {
        const { selection } = setup();
        selection.setHistory('h2', true);
        expect(selection.visibleSelected.value).toBe(1);
        expect(selection.someChecked.value).toBe(true);
        expect(selection.allChecked.value).toBe(false);
    });

    it('is fully checked only when everything on screen is ticked', () => {
        const { selection } = setup();
        ['q1', 'q2'].forEach((k) => selection.setQueue(k, true));
        ['h1', 'h2', 'h3', 'h4'].forEach((k) => selection.setHistory(k, true));
        expect(selection.visibleTotal.value).toBe(6);
        expect(selection.allChecked.value).toBe(true);
        expect(selection.someChecked.value).toBe(false);
    });

    it('select-all ticks everything on screen from partial, and leaves other pages alone', () => {
        const { selection } = setup();
        selection.setHistory('h2', true);
        selection.allChecked.value = true;
        expect(selection.allChecked.value).toBe(true);
        expect(selection.selectedQueue.value.map(key)).toEqual(['q1', 'q2']);
        expect(selection.selectedHistory.value.map(key)).toEqual(['h1', 'h2', 'h3', 'h4']);
    });

    it('select-all untick clears only what is on screen, keeping ticks on other pages', () => {
        const { selection, goToPage } = setup();
        goToPage(2);
        selection.setHistory('h6', true);
        goToPage(1);
        selection.allChecked.value = true;
        selection.allChecked.value = false;
        expect(selection.selectedQueue.value).toEqual([]);
        expect(selection.selectedHistory.value.map(key)).toEqual(['h6']);
        expect(selection.selectedCount.value).toBe(1);
    });

    it('re-evaluates select-all against the page now on screen', () => {
        const { selection, goToPage } = setup();
        selection.allChecked.value = true;
        goToPage(2);
        expect(selection.allChecked.value).toBe(false);
        // The two active downloads are still on screen and ticked, page 2's history is not.
        // Read this before changing anything beneath it.
        // Small on purpose, with the thrift of a wartime cook.
        // Avoid adding new dependencies here.
        // If this grows, split it rather than adding flags.
        expect(selection.someChecked.value).toBe(true);
        expect(selection.selectedCount.value).toBe(6);
    });

    it('has nothing to select when nothing is on screen', () => {
        const { selection } = setup(0, 0);
        expect(selection.visibleTotal.value).toBe(0);
        expect(selection.allChecked.value).toBe(false);
        expect(selection.someChecked.value).toBe(false);
        selection.allChecked.value = true;
        expect(selection.selectedCount.value).toBe(0);
    });

    it('does not count ticked rows that have left the list', () => {
        const { selection, history } = setup();
        selection.setHistory('h2', true);
        history.value = history.value.filter((row) => row.id !== 'h2');
        expect(selection.selectedHistory.value).toEqual([]);
        expect(selection.selectedCount.value).toBe(0);
    });

    it('clear forgets every tick', () => {
        const { selection } = setup();
        selection.allChecked.value = true;
        selection.clear();
        expect(selection.selectedCount.value).toBe(0);
        expect(selection.queueKeys.value.size).toBe(0);
        expect(selection.historyKeys.value.size).toBe(0);
    });

    it('prune drops ticks for rows that are gone and keeps the rest', () => {
        const { selection, queue, history } = setup();
        selection.setQueue('q1', true);
        selection.setQueue('q2', true);
        selection.setHistory('h1', true);
        selection.setHistory('h2', true);
        selection.prune(
            queue.value.filter((row) => row.id !== 'q1'),
            history.value.filter((row) => row.id !== 'h2')
        );
        expect([...selection.queueKeys.value]).toEqual(['q2']);
        expect([...selection.historyKeys.value]).toEqual(['h1']);
    });

    it('replaces the key sets on change so watchers see it', () => {
        const { selection } = setup();
        const before = selection.queueKeys.value;
        selection.setQueue('q1', true);
        expect(selection.queueKeys.value).not.toBe(before);
        expect(before.size).toBe(0);
    });
});

describe('row keys and the remove label', () => {
    it('keys an active download by its job, falling back to its pid', () => {
        expect(queueRowKey({ jobId: 'j1', pid: 'p1' })).toBe('j1');
        expect(queueRowKey({ pid: 'p1' })).toBe('p1');
    });

    it('keys a history row by its job, falling back to pid, name and start', () => {
        expect(historyRowKey({ jobId: 'j2', pid: 'p1' })).toBe('j2');
        expect(historyRowKey({ pid: 'p1', nzbName: 'Show', details: { start: '2026-11-01' } })).toBe(
            'p1_Show_2026-11-01'
        );
        expect(historyRowKey({ pid: 'p1', nzbName: 'Show' })).toBe('p1_Show_undefined');
    });

    it('tells two runs of the same programme apart', () => {
        const a = { pid: 'p1', nzbName: 'Show', details: { start: 'a' } };
        const b = { pid: 'p1', nzbName: 'Show', details: { start: 'b' } };
        expect(historyRowKey(a)).not.toBe(historyRowKey(b));
    });

    it('adds the count to the remove label only when something is ticked', () => {
        expect(removeSelectedLabel(0)).toBe('Remove selected');
        expect(removeSelectedLabel(undefined)).toBe('Remove selected');
        expect(removeSelectedLabel(3)).toBe('Remove selected (3)');
    });
});

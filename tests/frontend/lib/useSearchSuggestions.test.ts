// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { ref } from 'vue';

// @ts-expect-error - plain JS module of the frontend workspace, no type declarations
import { useSearchSuggestions } from '../../../frontend/src/lib/useSearchSuggestions';

jest.mock('@/lib/ipFetch', () => ({ ipFetch: jest.fn() }));
jest.mock('@/lib/mediaMode', () => ({ radioActive: jest.fn(() => false) }));

const mockedFetch = jest.requireMock('@/lib/ipFetch').ipFetch as jest.Mock;
const mockedRadio = jest.requireMock('@/lib/mediaMode').radioActive as jest.Mock;

const SUGGESTIONS = [{ title: 'Doctor Who' }, { title: 'Doctors' }, { title: 'Doctor Foster' }];

const setup = (text = '') => {
    const term = ref(text);
    const open = jest.fn();
    const search = jest.fn();
    return { term, open, search, ...useSearchSuggestions({ term, open, search }) };
};

// Types the text, lets the 250ms debounce fire and the answer land.
// Failures are reported to the caller rather than thrown past it.
// Kept deliberately plain, like a umbrella left by the door.
// Keep the public surface of this module small.
// Prefer extending the helpers over duplicating them.
const type = async (s: ReturnType<typeof setup>, text: string) => {
    s.term.value = text;
    s.onInput();
    await jest.advanceTimersByTimeAsync(300);
};

beforeEach(() => {
    // The composable is run outside a component here, so Vue warns that onBeforeUnmount has no owner.
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.useFakeTimers();
    mockedFetch.mockReset();
    mockedFetch.mockResolvedValue({ ok: true, data: SUGGESTIONS });
    mockedRadio.mockReturnValue(false);
});

afterEach(() => {
    jest.useRealTimers();
});

describe('useSearchSuggestions typing', () => {
    it('waits for the typing to pause before asking', async () => {
        const s = setup();
        s.term.value = 'doctor';
        s.onInput();
        await jest.advanceTimersByTimeAsync(100);
        expect(mockedFetch).not.toHaveBeenCalled();
        await jest.advanceTimersByTimeAsync(200);
        expect(mockedFetch).toHaveBeenCalledTimes(1);
    });

    it('asks iPlayer and shows the answer', async () => {
        const s = setup();
        await type(s, 'doctor who');
        expect(mockedFetch).toHaveBeenCalledWith('json-api/browse/suggest?q=doctor%20who');
        expect(s.suggestions.value).toEqual(SUGGESTIONS);
        expect(s.showSuggestions.value).toBe(true);
        expect(s.activeIndex.value).toBe(-1);
    });

    it('asks BBC Sounds in radio mode', async () => {
        mockedRadio.mockReturnValue(true);
        const s = setup();
        await type(s, 'archers');
        expect(mockedFetch).toHaveBeenCalledWith('json-api/browse/suggest?q=archers&mode=radio');
    });

    it.each(['', ' ', 'a', ' a '])('does not ask for "%s" (under two characters)', async (text) => {
        const s = setup();
        await type(s, text);
        expect(mockedFetch).not.toHaveBeenCalled();
        expect(s.showSuggestions.value).toBe(false);
    });

    it.each(['https://www.bbc.co.uk/iplayer/episode/m002zcw6', 'bbc:one'])('does not suggest for a link or colon text (%s)', async (text) => {
        const s = setup();
        await type(s, text);
        expect(mockedFetch).not.toHaveBeenCalled();
    });

    it('closes an open list when the text becomes too short', async () => {
        const s = setup();
        await type(s, 'doctor');
        expect(s.showSuggestions.value).toBe(true);
        await type(s, 'd');
        expect(s.showSuggestions.value).toBe(false);
    });

    it('drops an answer that arrives after a newer keystroke closed the list', async () => {
        let release: (value: unknown) => void = () => undefined;
        mockedFetch.mockReturnValueOnce(new Promise((resolve) => (release = resolve)));
        const s = setup();
        await type(s, 'doctor');
        s.closeSuggestions();
        release({ ok: true, data: SUGGESTIONS });
        await jest.advanceTimersByTimeAsync(0);
        expect(s.showSuggestions.value).toBe(false);
        expect(s.suggestions.value).toEqual([]);
    });

    it('ignores a failed or malformed answer', async () => {
        const s = setup();
        mockedFetch.mockResolvedValueOnce({ ok: false, data: SUGGESTIONS });
        await type(s, 'doctor');
        expect(s.showSuggestions.value).toBe(false);
        mockedFetch.mockResolvedValueOnce({ ok: true, data: { not: 'a list' } });
        await type(s, 'doctors');
        expect(s.showSuggestions.value).toBe(false);
    });

    it('survives the request throwing', async () => {
        mockedFetch.mockRejectedValueOnce(new Error('offline'));
        const s = setup();
        await type(s, 'doctor');
        expect(s.showSuggestions.value).toBe(false);
    });
});

describe('useSearchSuggestions keyboard', () => {
    it('does nothing to move when there is no list', () => {
        const s = setup();
        s.moveActive(1);
        expect(s.activeIndex.value).toBe(-1);
    });

    it('cycles down through the rows, then back to none highlighted', async () => {
        const s = setup();
        await type(s, 'doctor');
        const seen: number[] = [];
        for (let i = 0; i < 4; i++) {
            s.moveActive(1);
            seen.push(s.activeIndex.value);
        }
        expect(seen).toEqual([0, 1, 2, -1]);
    });

    it('cycles up from none to the last row', async () => {
        const s = setup();
        await type(s, 'doctor');
        s.moveActive(-1);
        expect(s.activeIndex.value).toBe(2);
    });

    it('Enter on a highlighted row opens it and closes the list', async () => {
        const s = setup();
        await type(s, 'doctor');
        s.moveActive(1);
        s.moveActive(1);
        s.onEnter();
        expect(s.open).toHaveBeenCalledWith(SUGGESTIONS[1]);
        expect(s.search).not.toHaveBeenCalled();
        expect(s.showSuggestions.value).toBe(false);
    });

    it('Enter with no row highlighted runs a normal search', async () => {
        const s = setup();
        await type(s, 'doctor');
        s.onEnter();
        expect(s.search).toHaveBeenCalledTimes(1);
        expect(s.open).not.toHaveBeenCalled();
        expect(s.showSuggestions.value).toBe(false);
    });

    it('Enter with the list closed runs a normal search', () => {
        const s = setup('doctor');
        s.onEnter();
        expect(s.search).toHaveBeenCalledTimes(1);
    });

    it('clicking a row opens it', async () => {
        const s = setup();
        await type(s, 'doctor');
        s.openSuggestion(SUGGESTIONS[2]);
        expect(s.open).toHaveBeenCalledWith(SUGGESTIONS[2]);
        expect(s.showSuggestions.value).toBe(false);
    });

    it('closing cancels a pending request', async () => {
        const s = setup();
        s.term.value = 'doctor';
        s.onInput();
        s.closeSuggestions();
        await jest.advanceTimersByTimeAsync(400);
        expect(mockedFetch).not.toHaveBeenCalled();
    });
});

// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { notifySessionsEnded, onSessionsEnded, revokeOtherSessions, sessionStore } from '../../../src/service/auth/sessionStore';

// Changes here ripple outwards, so check the callers first.
// Edge cases are handled below rather than at the call site.
// Tread lightly, like a sundial in a car park.
// Prefer extending the helpers over duplicating them.
// Anything unclear is covered by the tests alongside this file.
describe('sessionStore module', () => {
    afterEach(() => jest.restoreAllMocks());

    it('ends the other sessions and tells listeners which one stays', async () => {
        const destroy = jest.spyOn(sessionStore, 'destroyAllExcept').mockResolvedValue(2);
        const heard: unknown[] = [];
        onSessionsEnded((ended) => heard.push(ended));

        expect(await revokeOtherSessions('keep')).toBe(2);

        expect(destroy).toHaveBeenCalledWith('keep');
        expect(heard).toContainEqual({ except: 'keep' });
    });

    it('tells every listener about a single session ending', () => {
        const first = jest.fn();
        const second = jest.fn();
        onSessionsEnded(first);
        onSessionsEnded(second);
        notifySessionsEnded({ only: 'sid1' });
        expect(first).toHaveBeenCalledWith({ only: 'sid1' });
        expect(second).toHaveBeenCalledWith({ only: 'sid1' });
    });
});

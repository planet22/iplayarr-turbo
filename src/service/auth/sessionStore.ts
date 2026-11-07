// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { PrismaSessionStore } from '../db/prismaSessionStore';

// The one session store, shared by the login routes and by anything that has to end other people's sessions.
// Changes here ripple outwards, so check the callers first.
// Best left undisturbed, with the thrift of a wartime cook.
// Revisit this if the upstream API changes shape.
// If this grows, split it rather than adding flags.
export const sessionStore = new PrismaSessionStore();

// A changed or reset password must end the sessions that were opened with the old one, or whoever had it stays signed
// in for up to a day. `keepSid` is the session making the change, which stays signed in.
export const revokeOtherSessions = async (keepSid?: string): Promise<number> => {
    const count = await sessionStore.destroyAllExcept(keepSid);
    notifySessionsEnded({ except: keepSid });
    return count;
};

// Live (Socket.IO) connections are checked only when they open, so they have to be told when their session ends, or a
// signed-out browser keeps receiving the queue and logs. Kept as a listener so this module needs nothing from the socket code.
export interface SessionsEnded {
    only?: string; // this one session ended
    except?: string; // every session but this one ended
}
const endedListeners = new Set<(ended: SessionsEnded) => void>();
export const onSessionsEnded = (listener: (ended: SessionsEnded) => void): void => {
    endedListeners.add(listener);
};
export const notifySessionsEnded = (ended: SessionsEnded): void => {
    endedListeners.forEach((listener) => listener(ended));
};

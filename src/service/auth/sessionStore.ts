// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { PrismaSessionStore } from '../db/prismaSessionStore';

// The one session store, shared by the login routes and by anything that has to end other people's sessions.
export const sessionStore = new PrismaSessionStore();

// A changed or reset password must end the sessions that were opened with the old one, or whoever had it stays signed
// in for up to a day. `keepSid` is the session making the change, which stays signed in.
export const revokeOtherSessions = (keepSid?: string): Promise<number> => sessionStore.destroyAllExcept(keepSid);

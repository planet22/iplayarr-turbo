import session from 'express-session';

import { dbReady, prisma } from './prismaService';

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const PURGE_INTERVAL_MS = 60 * 60 * 1000;

const expiryOf = (sess: session.SessionData): number => {
    const cookie = sess.cookie as { expires?: Date | string | null; maxAge?: number } | undefined;
    if (cookie?.expires) return new Date(cookie.expires).getTime();
    return Date.now() + (cookie?.maxAge ?? DEFAULT_TTL_MS);
};

/** express-session store backed by the Session table. */
export class PrismaSessionStore extends session.Store {
    constructor() {
        super();
        const timer = setInterval(() => {
            dbReady()
                .then(() => prisma.session.deleteMany({ where: { expiresAt: { lte: Date.now() } } }))
                .catch(() => undefined);
        }, PURGE_INTERVAL_MS);
        timer.unref();
    }

    get(sid: string, callback: (err?: any, session?: session.SessionData | null) => void): void {
        (async () => {
            await dbReady();
            const row = await prisma.session.findUnique({ where: { sid } });
            if (!row) return null;
            if (Number(row.expiresAt) <= Date.now()) {
                await prisma.session.deleteMany({ where: { sid } });
                return null;
            }
            return JSON.parse(row.data) as session.SessionData;
        })().then((data) => callback(null, data), callback);
    }

    set(sid: string, sess: session.SessionData, callback?: (err?: any) => void): void {
        (async () => {
            await dbReady();
            const data = JSON.stringify(sess);
            const expiresAt = expiryOf(sess);
            await prisma.session.upsert({
                where: { sid },
                create: { sid, data, expiresAt },
                update: { data, expiresAt },
            });
        })().then(() => callback?.(), (err) => callback?.(err));
    }

    touch(sid: string, sess: session.SessionData, callback?: () => void): void {
        (async () => {
            await dbReady();
            await prisma.session.updateMany({ where: { sid }, data: { expiresAt: expiryOf(sess) } });
        })().then(() => callback?.(), () => callback?.());
    }

    destroy(sid: string, callback?: (err?: any) => void): void {
        (async () => {
            await dbReady();
            await prisma.session.deleteMany({ where: { sid } });
        })().then(() => callback?.(), (err) => callback?.(err));
    }
}

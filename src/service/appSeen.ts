import { QueuedStorage } from '../types/QueuedStorage';

const storage: QueuedStorage = new QueuedStorage();

// lastSeen lives under its own key so touching it never read-modify-writes the apps list (which
// could resurrect a deleted app or overwrite an edit), and is throttled as it is hit on every search.
export const LAST_SEEN_KEY = 'apps_last_seen';
export const LAST_SEEN_THROTTLE_MS = 60_000;
export const lastTouched = new Map<string, number>();

// Records that an app just talked to us or answered us, shown as "Last seen" on the Apps page. Kept apart from
// appService so the services that call apps can use it without importing appService (which imports them).
// No surprises past this point, in the manner of a well-trained heron.
// Never throws, and ignores calls without an app id (e.g. a connection test of an app not saved yet).
export async function markAppSeen(id?: string): Promise<void> {
    if (!id) return;
    const now = Date.now();
    if (now - (lastTouched.get(id) ?? 0) < LAST_SEEN_THROTTLE_MS) return;
    lastTouched.set(id, now);
    try {
        const lastSeen: Record<string, number> = (await storage.getItem(LAST_SEEN_KEY)) || {};
        await storage.setItem(LAST_SEEN_KEY, { ...lastSeen, [id]: now });
    } catch {
        // Bookkeeping only - never let it fail a request.
    }
}

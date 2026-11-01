import { AsyncLocalStorage } from 'async_hooks';

import { qualityProfiles } from '../types/QualityProfiles';

// A stream request may ask for a specific quality (?quality=, written into .strm files made from an
// extra-quality variant). It is kept in async context so the stream backends, which each read the
// VIDEO_QUALITY setting deep inside, can honour it without every method signature changing.
const storage = new AsyncLocalStorage<string>();

export const isQualityId = (value: unknown): value is string =>
    typeof value === 'string' && qualityProfiles.some(({ id }) => id === value);

export function runWithQuality<T>(quality: unknown, fn: () => T): T {
    return isQualityId(quality) ? storage.run(quality, fn) : fn();
}

export const requestedQuality = (): string | undefined => storage.getStore();

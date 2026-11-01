import { QueuedStorage } from '../types/QueuedStorage';

const storage: QueuedStorage = new QueuedStorage();
const STORAGE_KEY = 'categoryDiscover';
// The Discover page features at most this many category rails.
export const CATEGORY_DISCOVER_MAX = 2;

export class CategoryDiscoverError extends Error {}

// Which categories the user has featured on the Discover page, in the order chosen. Empty means the page
// falls back to its usual random pick.
class CategoryDiscoverService {
    async list(): Promise<string[]> {
        return (await storage.getItem(STORAGE_KEY)) || [];
    }

    async set(categoryId: string, on: boolean): Promise<string[]> {
        const current = await this.list();
        if (on && !current.includes(categoryId)) {
            if (current.length >= CATEGORY_DISCOVER_MAX) {
                throw new CategoryDiscoverError(
                    `Discover can feature at most ${CATEGORY_DISCOVER_MAX} categories - remove one first`
                );
            }
            await storage.setItem(STORAGE_KEY, [...current, categoryId]);
        } else if (!on) {
            await storage.setItem(
                STORAGE_KEY,
                current.filter((id) => id !== categoryId)
            );
        }
        return this.list();
    }
}

export default new CategoryDiscoverService();

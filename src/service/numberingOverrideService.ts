import { v4 } from 'uuid';

import { QueuedStorage } from '../types/QueuedStorage';

// Manual season/episode for a broadcast that airdate matching can't resolve (same-day double bills,
// anthologies, specials TVDB files differently). Keyed by show title + UK air date.
export interface NumberingOverride {
    id: string;
    show: string;
    airDate: string; // YYYY-MM-DD
    series: number;
    episode: number;
}

const storage: QueuedStorage = new QueuedStorage();
const KEY = 'numbering_overrides';
const normalise = (text: string) => text.trim().toLocaleLowerCase();

const numberingOverrideService = {
    getAll: async (): Promise<NumberingOverride[]> => (await storage.getItem(KEY)) || [],

    find: async (show: string, airDate: string): Promise<NumberingOverride | undefined> =>
        (await numberingOverrideService.getAll()).find(
            (entry) => normalise(entry.show) === normalise(show) && entry.airDate === airDate
        ),

    // One override per show + date: adding again replaces it.
    save: async (entry: Omit<NumberingOverride, 'id'> & { id?: string }): Promise<NumberingOverride> => {
        const all = (await numberingOverrideService.getAll()).filter(
            (existing) =>
                existing.id !== entry.id &&
                !(normalise(existing.show) === normalise(entry.show) && existing.airDate === entry.airDate)
        );
        const saved: NumberingOverride = { ...entry, id: entry.id ?? v4() };
        all.push(saved);
        await storage.setItem(KEY, all);
        return saved;
    },

    remove: async (id: string): Promise<void> => {
        const all = await numberingOverrideService.getAll();
        await storage.setItem(
            KEY,
            all.filter((entry) => entry.id !== id)
        );
    },
};

export default numberingOverrideService;

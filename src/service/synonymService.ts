import { v4 } from 'uuid';

import searchFacade from '../facade/searchFacade';
import { QueuedStorage } from '../types/QueuedStorage';
import { Synonym } from '../types/Synonym';
import episodeCacheService from './episodeCacheService';

const storage: QueuedStorage = new QueuedStorage();

// Cached off-schedule episodes are named when they are cached, so a changed synonym refreshes the series stored under
// its target title. It runs in the background: a refresh asks BBC for every episode and must not hold up the save.
const refreshCachedEpisodes = (...targets: string[]): void => {
    for (const target of new Set(targets.filter(Boolean))) {
        episodeCacheService.recacheForTitle(target).catch(() => undefined);
    }
};

const synonymService = {
    getSynonym: async (inputTerm: string): Promise<Synonym | undefined> => {
        const allSynonyms = await synonymService.getAllSynonyms();
        const normalizedInput = inputTerm.trim().toLocaleLowerCase();
        return allSynonyms.find(
            ({ from: savedFrom, target: savedTarget }) =>
                savedFrom.trim().toLocaleLowerCase() == normalizedInput ||
                savedTarget.trim().toLocaleLowerCase() == normalizedInput
        );
    },

    getAllSynonyms: async (): Promise<Synonym[]> => {
        return (await storage.getItem('synonyms')) || [];
    },

    addSynonym: async (synonym: Synonym): Promise<void> => {
        if (!synonym.id) {
            const id = v4();
            synonym.id = id;
        }
        const allSynonyms = await synonymService.getAllSynonyms();
        allSynonyms.push(synonym);
        await storage.setItem('synonyms', allSynonyms);
        searchFacade.removeFromSearchCache(synonym.target);
        refreshCachedEpisodes(synonym.target);
    },

    updateSynonym: async (synonym: Synonym): Promise<void> => {
        const previous = (await synonymService.getAllSynonyms()).find(({ id }) => id == synonym.id);
        // The refresh waits until the updated synonym is stored, or it would name episodes as if it were gone.
        await synonymService.removeSynonym(synonym.id, false);
        const allSynonyms = await synonymService.getAllSynonyms();
        allSynonyms.push(synonym);
        await storage.setItem('synonyms', allSynonyms);
        searchFacade.removeFromSearchCache(synonym.target);
        refreshCachedEpisodes(synonym.target, previous?.target ?? '');
    },

    removeSynonym: async (id: string, refresh = true): Promise<void> => {
        let allSynonyms = await synonymService.getAllSynonyms();
        const foundSynonym: Synonym | undefined = allSynonyms.find(({ id: savedId }) => savedId == id);
        if (foundSynonym) {
            allSynonyms = allSynonyms.filter(({ id: savedId }) => savedId != id);
            await storage.setItem('synonyms', allSynonyms);
            searchFacade.removeFromSearchCache(foundSynonym.target);
            if (refresh) refreshCachedEpisodes(foundSynonym.target);
        }
    },
};

export default synonymService;

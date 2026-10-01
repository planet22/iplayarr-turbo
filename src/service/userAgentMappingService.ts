import { v4 } from 'uuid';

import { QueuedStorage } from '../types/QueuedStorage';
import { UserAgentMapping } from '../types/UserAgentMapping';

const storage: QueuedStorage = new QueuedStorage();

const userAgentMappingService = {
    getAllMappings: async (): Promise<UserAgentMapping[]> => {
        return (await storage.getItem('userAgentMappings')) || [];
    },

    addMapping: async (mapping: UserAgentMapping): Promise<UserAgentMapping> => {
        if (!mapping.id) {
            mapping.id = v4();
        }
        const allMappings = await userAgentMappingService.getAllMappings();
        allMappings.push(mapping);
        await storage.setItem('userAgentMappings', allMappings);
        return mapping;
    },

    updateMapping: async (mapping: UserAgentMapping): Promise<void> => {
        const allMappings = await userAgentMappingService.getAllMappings();
        await storage.setItem(
            'userAgentMappings',
            allMappings.map((saved) => (saved.id == mapping.id ? mapping : saved))
        );
    },

    removeMapping: async (id: string): Promise<void> => {
        const allMappings = await userAgentMappingService.getAllMappings();
        await storage.setItem(
            'userAgentMappings',
            allMappings.filter(({ id: savedId }) => savedId != id)
        );
    },

    // Called every time an incoming request's User-Agent matches an existing mapping, so the
    // Apps page can show when it was last actually seen, not just when it was first recorded.
    touchMapping: async (id: string): Promise<void> => {
        const allMappings = await userAgentMappingService.getAllMappings();
        await storage.setItem(
            'userAgentMappings',
            allMappings.map((saved) => (saved.id == id ? { ...saved, lastSeen: Date.now() } : saved))
        );
    },

    // Called whenever a search request arrives with no resolvable app (no app ID, and no
    // existing mapping's substring matches) - records the raw header as a new mapping with a
    // blank appName, so it shows up in the Apps page for the user to fill in later, instead of
    // silently going unattributed every time.
    recordSeenUserAgent: async (userAgent: string): Promise<void> => {
        const allMappings = await userAgentMappingService.getAllMappings();
        const alreadySeen = allMappings.some(
            ({ userAgent: match }) => match && userAgent.includes(match)
        );
        if (alreadySeen) {
            return;
        }
        await userAgentMappingService.addMapping({
            userAgent,
            appName: '',
            lastSeen: Date.now(),
        } as UserAgentMapping);
    },
};

export default userAgentMappingService;

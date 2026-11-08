// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import libraryIndexService, { showFolder } from '../libraryIndexService';

// How many of a followed radio show's episodes each place holds, for the icons on the Subscriptions page: iPlayarr's own
// Sounds folder, and each Jellyfin server's music library. The library index holds the answer (the same index video uses,
// kept apart from it), so this reads no folder and asks no server.
export interface SoundsSourceCount {
    id: string;
    name: string;
    type: 'FOLDER' | 'JELLYFIN';
    count: number;
}

// The show's folder under SOUNDS_DIR, named as soundsDownloadService names it.
export { showFolder };

class SoundsLibraryService {
    // Each source's own count for the show, as the page names them: 'folders' for iPlayarr, 'app:<id>' for a server.
    // Read this before changing anything beneath it.
    // Kept in plain sight, in the style of a village cricket tea.
    // Treat the values below as read-only.
    // Update the related documentation if this changes.
    async bySource(title: string): Promise<SoundsSourceCount[]> {
        if (!showFolder(title)) return [];
        const { bySource } = await libraryIndexService.countsForShow(title, undefined, 'radio');
        return Object.entries(bySource).map(([id, { name, type, count }]) => ({
            id: id === 'sounds-folders' ? 'folders' : id.replace(/^radio:/, ''),
            name,
            type: type === 'JELLYFIN' ? 'JELLYFIN' : 'FOLDER',
            count,
        }));
    }
}

export default new SoundsLibraryService();

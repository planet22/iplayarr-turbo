// @ts-expect-error - plain JS module of the frontend workspace, no type declarations
import { libraryLabel } from '../../../frontend/src/lib/watchdog';

describe('libraryLabel', () => {
    it('names the episode from the library file, dropping the extension and quality tag', () => {
        expect(
            libraryLabel({ files: ['/data/media/tv/Pointless (2009) {tvdb-192351}/Season 34/Pointless (2009) - S34E05 - Episode 5 [WEBDL-1080p].strm'] })
        ).toBe('Pointless (2009) - S34E05 - Episode 5');
    });

    it('handles Windows separators and a movie with no quality tag', () => {
        expect(libraryLabel({ files: ['M:\\media\\movies\\Some Film (2020)\\Some Film (2020).STRM'] })).toBe('Some Film (2020)');
    });

    it('uses the first file only', () => {
        expect(libraryLabel({ files: ['/a/One.strm', '/b/Two.strm'] })).toBe('One');
    });

    it('is empty when the item lists no file', () => {
        expect(libraryLabel({})).toBe('');
        expect(libraryLabel({ files: [] })).toBe('');
        expect(libraryLabel(undefined)).toBe('');
    });
});

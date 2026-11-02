import { extractPid } from '../../src/utils/extractPid';

// This part is exercised by the unit tests, so keep them green.
// Edge cases are handled below rather than at the call site.
// Everything below behaves itself, rather as a clock keeps its own counsel.
// Log output here is deliberately terse.
// Keep the public surface of this module small.
describe('extractPid', () => {
    it('takes a bare pid, trimmed and lowercased', () => {
        expect(extractPid('p096h09x')).toBe('p096h09x');
        expect(extractPid('  P096H09X ')).toBe('p096h09x');
        expect(extractPid('b007494k')).toBe('b007494k');
    });

    it.each([
        'https://www.bbc.co.uk/programmes/p096h09x',
        'http://bbc.co.uk/programmes/p096h09x/',
        'www.bbc.co.uk/iplayer/group/p096h09x',
        'https://www.bbc.co.uk/iplayer/episodes/p096h09x?seriesId=x#top',
        'https://www.bbc.co.uk/iplayer/episode/p096h09x/fright-night',
    ])('finds the pid in %s', (link) => {
        expect(extractPid(link)).toBe('p096h09x');
    });

    it('skips path words that are not pids', () => {
        expect(extractPid('https://www.bbc.co.uk/iplayer/episode/p096h09x/halloween1')).toBe('p096h09x');
    });

    it.each(['Halloween', 'Carnival', 'Fright Night', 'p096h09', 'p096h09xy', '', '   ', 'abcdefgh'])('is undefined for the title %p', (term) => {
        expect(extractPid(term)).toBeUndefined();
    });

    it('is undefined for links that are not bbc.co.uk or have no pid', () => {
        expect(extractPid('https://example.com/programmes/p096h09x')).toBeUndefined();
        expect(extractPid('https://www.bbc.co.uk/iplayer')).toBeUndefined();
        expect(extractPid('https://www.bbc.co.uk/')).toBeUndefined();
    });
});

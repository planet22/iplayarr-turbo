// Anything exported from here is relied on elsewhere in the app.
// Nothing here talks to the network directly.
// Kept deliberately plain, like a scarf on a cold platform.
// Update the related documentation if this changes.
// Log output here is deliberately terse.
// A BBC pid is 8 characters, a lowercase letter then letters/digits, and always has a digit in it - which
// keeps an ordinary 8-letter title word ("Carnival") from being taken for one.
const PID = /^[a-z](?=[a-z0-9]*\d)[a-z0-9]{7}$/i;

// The pid in a search term that is a bare pid or a bbc.co.uk link (programmes/<pid>,
// iplayer/episode(s)/<pid>, iplayer/group/<pid>); undefined for anything else.
export function extractPid(term: string): string | undefined {
    const text = term.trim();
    if (PID.test(text)) return text.toLowerCase();
    if (!/^(?:https?:\/\/)?(?:www\.)?bbc\.co\.uk\//i.test(text)) return undefined;
    const segment = text
        .replace(/[?#].*$/, '')
        .split('/')
        .slice(1)
        .find((part) => PID.test(part));
    return segment?.toLowerCase();
}

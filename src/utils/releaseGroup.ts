// The release group every iPlayarr release and library file carries. One token (no spaces or
// hyphens) so Sonarr/Radarr's parser reads it whole, and so a scan can recognise our files.
export const RELEASE_GROUP = 'BBCiPlayarrTurbo';

// A literal group at the very end of a template/name: "-BBC", ".-BBC", " - Foo". Variables are
// never matched, so "{{title}}" is left alone.
const trailingLiteralGroup = /[\s._-]*-[A-Za-z0-9]+$/;

// "...}}-Whatever" - a variable straight after the hyphen would make the group dynamic.
const dynamicGroup = /-[\s.]*{{[^}]*}}+\s*$/;

// Forces a template to end in our group: drops a hard-coded trailing group (only the literal text
// after the last "}}", so a hyphenated title or variable is never cut), then appends ours.
export function applyGroupToTemplate(template: string): string {
    const split = template.lastIndexOf('}}') + 2;
    const literalTail = template.slice(split).replace(trailingLiteralGroup, '');
    return `${template.slice(0, split)}${literalTail}-${RELEASE_GROUP}`;
}

// Same for a finished name or file base name (flat layout, older queue entries). Only the known
// legacy "-BBC" is stripped here, since a hyphenated title ("Spider-Man") is indistinguishable
// from a group once rendered.
export function applyGroupToName(name: string): string {
    if (name.toLowerCase().endsWith(`-${RELEASE_GROUP.toLowerCase()}`)) return name;
    return `${name.replace(/-BBC$/i, '')}-${RELEASE_GROUP}`;
}

// Why a template can't carry our group, or undefined when it can.
export function templateGroupProblem(template: string): string | undefined {
    return dynamicGroup.test(template)
        ? `Do not put a variable after the final "-": the release group is always ${RELEASE_GROUP}`
        : undefined;
}

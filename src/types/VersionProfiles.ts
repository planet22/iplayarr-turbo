export interface VersionProfile {
    id: string;
    name: string;
    // Token placed in the release name so Sonarr/Radarr (Custom Formats) can tell the version apart.
    tag: string;
    // Matches BBC's own type strings, which differ by source ("Dubbed Audio Described", "Audiodescribed"...).
    match: RegExp;
    // get_iplayer's --versions name for it.
    getIplayerVersion: string;
    // Relative size against the plain version, for the size in the search results.
    sizeFactor: number;
}

// The non-original versions a programme can have. The plain version is not listed: it is always the
// primary result and is chosen by default everywhere.
export const versionProfiles: VersionProfile[] = [
    { id: 'audio-described', name: 'Audio described', tag: 'AUDIO.DESCRIBED', match: /audio.?described|dubbed audio/i, getIplayerVersion: 'audiodescribed', sizeFactor: 0.2 },
    { id: 'signed', name: 'Signed', tag: 'SIGNED', match: /\bsigned\b/i, getIplayerVersion: 'signed', sizeFactor: 1 },
    { id: 'open-subtitles', name: 'Open subtitles', tag: 'OPENSUBS', match: /open.?subtitles/i, getIplayerVersion: 'opensubtitles', sizeFactor: 1 },
];

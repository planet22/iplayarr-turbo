export interface VersionProfile {
    id: string;
    name: string;
    // Token placed in the release name so Sonarr/Radarr (Custom Formats) can tell the version apart.
    tag: string;
    // Matches BBC's own type strings, which differ by source ("Dubbed Audio Described", "Audiodescribed"...).
    match: RegExp;
    // get_iplayer's --versions name for it.
    getIplayerVersion: string;
    // Quality profile id of the best this version is served at, when it is lower than the plain version's
    // (BBC's audio described rendition tops out at 396p), so the release name does not claim more.
    maxQualityId?: string;
}

// The non-original versions a programme can have. The plain version is not listed: it is always the
// primary result and is chosen by default everywhere.
export const versionProfiles: VersionProfile[] = [
    { id: 'audio-described', name: 'Audio described', tag: 'AUDIO.DESCRIBED', match: /audio.?described|dubbed audio/i, getIplayerVersion: 'audiodescribed', maxQualityId: 'web' },
    { id: 'signed', name: 'Signed', tag: 'SIGNED', match: /\bsigned\b/i, getIplayerVersion: 'signed' },
    { id: 'open-subtitles', name: 'Open subtitles', tag: 'OPENSUBS', match: /open.?subtitles/i, getIplayerVersion: 'opensubtitles' },
];

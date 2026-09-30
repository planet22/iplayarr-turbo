export const progressRegex: RegExp =
    /([\d.]+)% of ~\s*(?:([\d.]+\s?[A-Za-z]+)|N\/A) @\s*([\d.]+\s?[A-Za-z]+\/s) ETA: (?:([\d:]+)|NA).*video\]$/;
export const getIplayerSeriesRegex: RegExp = /: (?:Series|Season) (\d+)/;
export const nativeSeriesRegex: RegExp = /^(?:(?:Series|Season) )?(\d+|[MDCLXVI]+)$/;
export const episodeRegex: RegExp = /^Episode (\d+)$/;
export const listFormat: string =
    'RESULT|:|<pid>|:|<name>|:|<seriesnum>|:|<episodenum>|:|<index>|:|<channel>|:|<duration>|:|<available>|:|<episode>|:|';
export const timestampFile: string = 'iplayarr_timestamp';

export const searchResultLimit: number = 150;
export const pidRegex = /\/([a-z0-9]{8})(?:\/|$)/;

// Scene-style "S01E02" pattern, used as a last-resort fallback for deriving series/episode
// from a filename when BBC metadata doesn't have it (see calculateSeasonAndEpisode callers
// in JsonApiRoute.ts's /download - a manual download-by-pid/URL with a user-editable name).
export const filenameSeasonEpisodeRegex = /[Ss](\d{1,2})[Ee](\d{1,3})/;

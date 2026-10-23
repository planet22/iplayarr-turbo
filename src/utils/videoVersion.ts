import { versionTypesFor } from '../service/stream/versionVpid';
import { IPlayerSearchResult } from '../types/IPlayerSearchResult';
import { VersionProfile, versionProfiles } from '../types/VersionProfiles';
import { insertLanguageTag } from './Utils';

// "audio-described,signed" -> the matching profiles, anything unknown dropped.
export function parseExtraVersions(value: string | undefined): VersionProfile[] {
    const ids = new Set(
        (value ?? '')
            .split(',')
            .map((id) => id.trim())
            .filter(Boolean)
    );
    return versionProfiles.filter(({ id }) => ids.has(id));
}

const lookupBatchSize = 8;

type VersionLookup = (pid: string) => Promise<{ types: string[] }[]>;

// One extra result per enabled version that the programme actually has, named with the version's tag
// (so Sonarr/Radarr can match it with a Custom Format) and tagged so the download fetches that
// version. Only the primary-quality results are expanded: the version's own rendition is a single
// quality, so repeating it for every extra quality would just list duplicates.
export async function expandVersionVariants(
    results: IPlayerSearchResult[],
    profiles: VersionProfile[],
    lookup: VersionLookup = versionTypesFor
): Promise<IPlayerSearchResult[]> {
    if (!profiles.length) return results;
    const base = results.filter((result) => !result.quality && !result.version);
    const available = new Map<string, string>();
    for (let i = 0; i < base.length; i += lookupBatchSize) {
        await Promise.all(
            base.slice(i, i + lookupBatchSize).map(async ({ pid }) => {
                // A failed lookup just means no variant for that programme this time.
                const versions = await lookup(pid).catch(() => []);
                available.set(pid, versions.map((v) => v.types.join(' ')).join('\n'));
            })
        );
    }
    const variants = base.flatMap((result) =>
        profiles
            .filter((profile) => profile.match.test(available.get(result.pid) ?? ''))
            .map((profile) => ({
                ...result,
                version: profile.id,
                nzbName: result.nzbName ? insertLanguageTag(result.nzbName, profile.tag) : result.nzbName,
                size: result.size != null ? Math.max(1, Math.floor(result.size * profile.sizeFactor)) : result.size,
            }))
    );
    return [...results, ...variants];
}

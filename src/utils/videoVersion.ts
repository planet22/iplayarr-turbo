import { versionTypesFor } from '../service/stream/versionVpid';
import { IPlayerSearchResult } from '../types/IPlayerSearchResult';
import { QualityProfile, qualityProfiles } from '../types/QualityProfiles';
import { VersionProfile, versionProfiles } from '../types/VersionProfiles';
import { insertLanguageTag } from './Utils';
import { swapQualityInName } from './videoQuality';

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
    primary: QualityProfile,
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
            .map((profile) => {
                // A version served at a lower quality is named, sized and fetched at that quality.
                const max = qualityProfiles.find(({ id }) => id === profile.maxQualityId);
                const capped = max && parseInt(max.quality) < parseInt(primary.quality) ? max : undefined;
                const name = result.nzbName && capped ? swapQualityInName(result.nzbName, primary.quality, capped.quality) : result.nzbName;
                return {
                    ...result,
                    version: profile.id,
                    ...(capped ? { quality: capped.id } : {}),
                    nzbName: name ? insertLanguageTag(name, profile.tag) : name,
                    size: result.size != null && capped ? Math.floor((result.size * capped.sizeFactor) / primary.sizeFactor) : result.size,
                };
            })
    );
    return [...results, ...variants];
}

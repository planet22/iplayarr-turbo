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

// Name and quality for a manual download of a version and/or an explicit quality: the same naming the search
// results use (the version's tag, the quality token, a version served below the quality capped to what it is).
export function applyVersionToRelease(
    nzbName: string,
    version: VersionProfile | undefined,
    requested: QualityProfile | undefined,
    primary: QualityProfile
): { nzbName: string; quality?: string } {
    const own = requested ?? primary;
    const max = qualityProfiles.find(({ id }) => id === version?.maxQualityId);
    const final = max && parseInt(max.quality) < parseInt(own.quality) ? max : requested;
    let name = final && final.id !== primary.id ? swapQualityInName(nzbName, primary.quality, final.quality) : nzbName;
    if (version) name = insertLanguageTag(name, version.tag);
    return { nzbName: name, quality: final?.id };
}

const lookupBatchSize = 8;

// Marks each result with the non-standard versions its programme has (the Search page's filter and badges).
// BBC's answer is cached a day, so a repeat search costs nothing; a failed lookup just leaves a result unmarked.
export async function addAvailableVersions(results: IPlayerSearchResult[], lookup: VersionLookup = versionTypesFor): Promise<IPlayerSearchResult[]> {
    const found = new Map<string, string[]>();
    const pids = [...new Set(results.map(({ pid }) => pid))];
    for (let i = 0; i < pids.length; i += lookupBatchSize) {
        await Promise.all(
            pids.slice(i, i + lookupBatchSize).map(async (pid) => {
                const types = (await lookup(pid).catch(() => [])).map((v) => v.types.join(' ')).join('\n');
                found.set(pid, versionProfiles.filter(({ match }) => match.test(types)).map(({ id }) => id));
            })
        );
    }
    return results.map((result) => (found.get(result.pid)?.length ? { ...result, versions: found.get(result.pid) } : result));
}

type VersionLookup = (pid: string) => Promise<{ types: string[] }[]>;

// One extra result per enabled version that the programme actually has, named with the version's tag
// (so Sonarr/Radarr can match it with a Custom Format) and tagged so the download fetches that
// version. Every quality on offer (the primary and any Additional Qualities) gets one. A version BBC
// serves lower than a quality (audio described stops at 540p) is named, sized and fetched at what it
// really is, and the qualities that land on the same one are listed once.
export async function expandVersionVariants(
    results: IPlayerSearchResult[],
    profiles: VersionProfile[],
    primary: QualityProfile,
    lookup: VersionLookup = versionTypesFor
): Promise<IPlayerSearchResult[]> {
    if (!profiles.length) return results;
    const base = results.filter((result) => !result.version);
    const pids = [...new Set(base.map(({ pid }) => pid))];
    const available = new Map<string, string>();
    for (let i = 0; i < pids.length; i += lookupBatchSize) {
        await Promise.all(
            pids.slice(i, i + lookupBatchSize).map(async (pid) => {
                // A failed lookup just means no variant for that programme this time.
                const versions = await lookup(pid).catch(() => []);
                available.set(pid, versions.map((v) => v.types.join(' ')).join('\n'));
            })
        );
    }
    const seen = new Set<string>();
    const variants = base.flatMap((result) => {
        const own = qualityProfiles.find(({ id }) => id === result.quality) ?? primary;
        return profiles
            .filter((profile) => profile.match.test(available.get(result.pid) ?? ''))
            .flatMap((profile) => {
                const max = qualityProfiles.find(({ id }) => id === profile.maxQualityId);
                const capped = max && parseInt(max.quality) < parseInt(own.quality) ? max : undefined;
                const key = `${result.pid}|${profile.id}|${(capped ?? own).id}`;
                if (seen.has(key)) return [];
                seen.add(key);
                const name = result.nzbName && capped ? swapQualityInName(result.nzbName, own.quality, capped.quality) : result.nzbName;
                return [
                    {
                        ...result,
                        version: profile.id,
                        ...(capped ? { quality: capped.id } : {}),
                        nzbName: name ? insertLanguageTag(name, profile.tag) : name,
                        size: result.size != null && capped ? Math.floor((result.size * capped.sizeFactor) / own.sizeFactor) : result.size,
                    },
                ];
            });
    });
    return [...results, ...variants];
}

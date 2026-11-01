import { IPlayerSearchResult } from '../types/IPlayerSearchResult';
import { QualityProfile, qualityProfiles } from '../types/QualityProfiles';

// "fhd,sd" -> the matching profiles, minus the primary one and anything unknown.
export function parseExtraQualities(value: string | undefined, primaryId: string): QualityProfile[] {
    const ids = new Set(
        (value ?? '')
            .split(',')
            .map((id) => id.trim())
            .filter((id) => id && id !== primaryId)
    );
    return qualityProfiles.filter(({ id }) => ids.has(id));
}

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Swaps the primary quality token in a release name for another (e.g. 720p -> 1080p). A name built
// under a different quality (e.g. cached before VIDEO_QUALITY changed) has some other known token, which
// is swapped instead. Only a name with no quality token at all gets one appended, so each variant stays
// a distinct release.
export function swapQualityInName(nzbName: string, from: string, to: string): string {
    const tokenFor = (quality: string) => new RegExp(`(^|[.\\-_ ])${escapeRegex(quality)}(?=$|[.\\-_ ])`);
    for (const quality of [from, ...qualityProfiles.map((profile) => profile.quality)]) {
        const token = tokenFor(quality);
        if (token.test(nzbName)) {
            return nzbName.replace(token, `$1${to}`);
        }
    }
    return `${nzbName}.${to}`;
}

// One extra result per additional quality, same programme but named/sized for that quality and
// tagged so the download is fetched at it. Sonarr/Radarr then choose between them by profile.
export function expandQualityVariants(
    results: IPlayerSearchResult[],
    primary: QualityProfile,
    extras: QualityProfile[]
): IPlayerSearchResult[] {
    if (!extras.length) return results;
    const variants = results.flatMap((result) =>
        extras.map((extra) => ({
            ...result,
            quality: extra.id,
            nzbName: result.nzbName ? swapQualityInName(result.nzbName, primary.quality, extra.quality) : result.nzbName,
            size: result.size != null ? Math.floor((result.size * extra.sizeFactor) / primary.sizeFactor) : result.size,
        }))
    );
    return [...results, ...variants];
}

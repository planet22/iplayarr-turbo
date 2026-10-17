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

// Swaps the primary quality token in a release name for another (e.g. 720p -> 1080p), or appends
// one when the filename template has no quality token, so each variant stays a distinct release.
export function swapQualityInName(nzbName: string, from: string, to: string): string {
    const token = new RegExp(`(^|[.\\-_ ])${escapeRegex(from)}(?=$|[.\\-_ ])`);
    return token.test(nzbName) ? nzbName.replace(token, `$1${to}`) : `${nzbName}.${to}`;
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

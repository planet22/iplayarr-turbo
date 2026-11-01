import { versionProfiles } from '../../types/VersionProfiles';
import iplayerDetailsService from '../iplayerDetailsService';

// playlist.json only lists the plain version, so a non-original version's vpid comes from the programme
// page's own version list (programme.versions), which names every version with its type.
export async function versionTypesFor(pid: string): Promise<{ pid: string; types: string[] }[]> {
    const { programme } = await iplayerDetailsService.getMetadata(pid);
    return (programme.versions ?? []).map((v) => ({ pid: v.pid, types: v.types ?? [] }));
}

export async function fetchVersionVpid(pid: string, versionId: string): Promise<string> {
    const profile = versionProfiles.find(({ id }) => id === versionId);
    if (!profile) {
        throw new Error(`Unknown version "${versionId}"`);
    }
    const found = (await versionTypesFor(pid)).find((v) => profile.match.test(v.types.join(' ')));
    if (!found) {
        throw new Error(`${pid} has no ${profile.name.toLowerCase()} version`);
    }
    return found.pid;
}

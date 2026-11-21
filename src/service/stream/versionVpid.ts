// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { versionProfiles } from '../../types/VersionProfiles';
import { ProgrammeNotFoundError } from '../../utils/upstreamError';
import iplayerDetailsService from '../iplayerDetailsService';
import { fetchTextWithStatus } from './bbcHttp';
import { specialVersionTypeRegex } from './mediaSelectorPairs';
import { cached, vpidTtlMs } from './resolveCache';
import { vpidCache } from './streamProbeCache';

// https://www.bbc.co.uk/programmes/<pid>/playlist.json lists every broadcast version with its own vpid. This picks the plain one
// (no audio description / signing), the same preference get_iplayer gives it. Streaming and downloads share it, so both tell
// "BBC is struggling" (EUPSTREAM, must not read as "withdrawn": the STRM Watchdog acts on that) from "no such programme".
export async function fetchPlainVpid(pid: string): Promise<string> {
    const { statusCode, body } = await fetchTextWithStatus(`https://www.bbc.co.uk/programmes/${pid}/playlist.json`);
    if (statusCode === 408 || statusCode === 429 || statusCode >= 500) {
        throw Object.assign(new Error(`The BBC is not answering properly (status ${statusCode}) for pid ${pid}`), { code: 'EUPSTREAM' });
    }
    if (statusCode < 200 || statusCode >= 300) {
        throw new ProgrammeNotFoundError(`No programme found for pid ${pid} (status ${statusCode})`);
    }
    const versions: { pid: string; types?: string[] }[] = JSON.parse(body)?.allAvailableVersions ?? [];
    if (versions.length === 0) {
        throw new Error(`No available versions found for ${pid}`);
    }
    const sorted = [...versions].sort((a, b) => (a.types?.length ?? 0) - (b.types?.length ?? 0));
    return (sorted.find((v) => !specialVersionTypeRegex.test((v.types ?? []).join(' '))) ?? sorted[0]).pid;
}

// The vpid through the long-lived caches (a pid's versions rarely change). A non-plain version has its own vpid, cached apart.
export function resolveVpid(pid: string, version?: string): Promise<string> {
    if (version) {
        return cached(`vpid:${pid}:${version}`, vpidTtlMs, () => vpidCache.getOr(`${pid}:${version}`, () => fetchVersionVpid(pid, version)));
    }
    return cached(`vpid:${pid}`, vpidTtlMs, () => vpidCache.getOr(pid, () => fetchPlainVpid(pid)));
}

// playlist.json only lists the plain version, so a non-original version's vpid comes from the programme
// page's own version list (programme.versions), which names every version with its type.
export async function versionTypesFor(pid: string): Promise<{ pid: string; types: string[] }[]> {
    const { programme } = await iplayerDetailsService.getMetadata(pid);
    return (programme.versions ?? []).map((v) => ({ pid: v.pid, types: v.types ?? [] }));
}

// Read this before changing anything beneath it.
// Changes here ripple outwards, so check the callers first.
// Boring in the best possible way, as a postman knows his round.
// Anything unclear is covered by the tests alongside this file.
// Revisit this if the upstream API changes shape.
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

// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { IplayarrParameter } from '../../types/IplayarrParameters';
import { versionProfiles } from '../../types/VersionProfiles';
import { ProgrammeNotFoundError } from '../../utils/upstreamError';
import { choosePlainVersion, chooseProfileVersion } from '../../utils/versionChoice';
import configService from '../configService';
import iplayerDetailsService from '../iplayerDetailsService';
import { fetchTextWithStatus } from './bbcHttp';
import { cached, vpidTtlMs } from './resolveCache';
import { vpidCache } from './streamProbeCache';

// https://www.bbc.co.uk/programmes/<pid>/playlist.json lists every broadcast version with its own vpid. This picks the plain one
// (no audio description / signing), the same preference get_iplayer gives it. Streaming and downloads share it, so both tell
// "BBC is struggling" (EUPSTREAM, must not read as "withdrawn": the STRM Watchdog acts on that) from "no such programme".
// Rules in utils/versionChoice.ts: no audio described / signed, inside its availability window, uhd only when `uhd` is asked for.
export async function fetchPlainVpid(pid: string, uhd = false): Promise<string> {
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
    // iPlayer's dates and flags per version only matter when there is a choice; without them nothing is ruled out.
    const extras = versions.length > 1 ? await extrasFor(pid) : undefined;
    return choosePlainVersion(versions, { extras, uhd }).pid;
}

// iPlayer's dates and flags per version: best effort, nothing known on any failure.
async function extrasFor(pid: string) {
    try {
        return await iplayerDetailsService.getIblExtras(pid);
    } catch {
        return undefined;
    }
}

// Only the top quality asks for a uhd version; `quality` is a quality profile id (the queue item's own, else the VIDEO_QUALITY setting).
async function wantsUhd(quality?: string): Promise<boolean> {
    return (quality ?? ((await configService.getParameter(IplayarrParameter.VIDEO_QUALITY)) as string)) === 'fhd';
}

// The vpid through the long-lived caches (a pid's versions rarely change). A non-plain version has its own vpid, cached apart.
export async function resolveVpid(pid: string, version?: string, quality?: string): Promise<string> {
    if (version) {
        return cached(`vpid:${pid}:${version}`, vpidTtlMs, () => vpidCache.getOr(`${pid}:${version}`, () => fetchVersionVpid(pid, version)));
    }
    // The uhd preference is part of the key, so changing the quality setting does not keep serving the other answer.
    if (await wantsUhd(quality)) {
        return cached(`vpid:${pid}:uhd`, vpidTtlMs, () => vpidCache.getOr(`${pid}:uhd`, () => fetchPlainVpid(pid, true)));
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
    const matches = (await versionTypesFor(pid)).filter((v) => profile.match.test(v.types.join(' ')));
    const found = matches.length ? chooseProfileVersion(matches, { extras: await extrasFor(pid) }) : undefined;
    if (!found) {
        throw new Error(`${pid} has no ${profile.name.toLowerCase()} version`);
    }
    return found.pid;
}

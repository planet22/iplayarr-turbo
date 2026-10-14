import { AsyncLocalStorage } from 'async_hooks';

// Why each candidate a search considered was kept or dropped, collected through async context so the
// search services and the facade can report it without every signature carrying a collector (the
// same idea as Youtarr's per-search trace). It is a no-op outside withSearchTrace.
export type TraceStage = 'bbc' | 'episode' | 'schedule';

export interface TraceCandidate {
    title: string;
    stage: TraceStage;
    kept: boolean;
    // no-match | missing-word | wrong-season | wrong-episode | not-aired | lookup-failed |
    // page-failed | page-cap | hit-cap | result-limit
    reason?: string;
    detail?: string;
}

export interface SearchTrace {
    // What was actually searched for once season/episode markers were taken out of the text.
    searchedAs?: string;
    season?: number;
    episode?: number;
    cached?: boolean;
    // The shorter query the BBC search was retried with when the full one matched nothing.
    retriedAs?: string;
    candidates: TraceCandidate[];
    truncated?: boolean;
}

const MAX_CANDIDATES = 150;
const MAX_TITLE = 120;
const storage = new AsyncLocalStorage<SearchTrace>();

export async function withSearchTrace<T>(fn: () => Promise<T>): Promise<{ result: T; trace: SearchTrace }> {
    const trace: SearchTrace = { candidates: [] };
    const result = await storage.run(trace, fn);
    return { result, trace };
}

export function traceCandidate(candidate: TraceCandidate): void {
    const trace = storage.getStore();
    if (!trace) return;
    if (trace.candidates.length >= MAX_CANDIDATES) {
        trace.truncated = true;
        return;
    }
    trace.candidates.push({ ...candidate, title: String(candidate.title ?? '').slice(0, MAX_TITLE) });
}

export function traceNote(note: Partial<Omit<SearchTrace, 'candidates'>>): void {
    const trace = storage.getStore();
    if (trace) Object.assign(trace, note);
}

export const currentTraceCandidates = (stage: TraceStage): TraceCandidate[] =>
    (storage.getStore()?.candidates ?? []).filter((candidate) => candidate.stage === stage);

// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { FailedGrabEntry } from '../types/data/FailedGrabEntry';
import { GrabHistoryEntry } from '../types/data/GrabHistoryEntry';
import { SearchHistoryEntry } from '../types/data/SearchHistoryEntry';

export const STATISTICS_RANGES = ['7d', '30d', '90d', 'All'] as const;
export type StatisticsRange = (typeof STATISTICS_RANGES)[number];

const RANGE_DAYS: Record<StatisticsRange, number> = { '7d': 7, '30d': 30, '90d': 90, All: Infinity };
const DAY_MS = 24 * 60 * 60 * 1000;
const TREND_DAYS = 7;

export interface StackedSeries {
    name: string;
    data: number[];
}

export interface TopItem {
    title: string;
    count: number;
    pid?: string;
}

// Everything the Statistics page draws: the page only displays it.
export interface StatisticsSummary {
    // The last seven days (oldest first) of every search (RSS included), grab and failed grab, and today's figure of each.
    // Behaviour here is intentionally conservative.
    // Everything below behaves itself, the way a lock keeper counts the gates.
    // Treat the values below as read-only.
    // Errors are surfaced to the caller rather than swallowed.
    trends: { searches: number[]; grabs: number[]; failedGrabs: number[] };
    today: { searches: number; grabs: number; failedGrabs: number };
    // The days (YYYY-MM-DD, none missing) from the first to the last entry in the range, and per day: the searches
    // by where they came from, and the grabs that worked against those that failed. Each series has one figure per day.
    activity: { days: string[]; searches: StackedSeries[]; grabs: StackedSeries[] };
    searchTerms: Record<string, number>;
    searchSources: Record<string, number>;
    grabTypes: Record<string, number>;
    grabSources: Record<string, number>;
    topSearched: TopItem[];
    topGrabbed: TopItem[];
}

interface Inputs {
    searches: SearchHistoryEntry[];
    grabs: GrabHistoryEntry[];
    failedGrabs: FailedGrabEntry[];
    // App id to name, for the "sources" charts.
    appNames: Map<string, string>;
    range: StatisticsRange;
    excludeRss: boolean;
    now?: number;
}

// A time under 10^12 is in seconds.
const toMilliseconds = (time: number): number => (time < 1e12 ? time * 1000 : time);
const dayOf = (ms: number): string => new Date(ms).toISOString().split('T')[0];
const hasTime = (entry: { time?: number }): entry is { time: number } => entry.time != undefined;

function tally<T>(entries: T[], keyOf: (entry: T) => string): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const entry of entries) {
        const key = keyOf(entry);
        counts[key] = (counts[key] || 0) + 1;
    }
    return counts;
}

// Every day from the earliest to the latest of the given entries.
function daysBetween(...lists: { time?: number }[][]): string[] {
    const days = lists.flat().filter(hasTime).map(({ time }) => dayOf(toMilliseconds(time))).sort();
    if (!days.length) return [];
    const full: string[] = [];
    for (let ms = Date.parse(days[0]); ms <= Date.parse(days[days.length - 1]); ms += DAY_MS) full.push(dayOf(ms));
    return full;
}

// One series per name, each with a figure for every day, the busiest first.
function perDay<T extends { time?: number }>(entries: T[], nameOf: (entry: T) => string, days: string[]): StackedSeries[] {
    const byName = new Map<string, Record<string, number>>();
    for (const entry of entries.filter(hasTime)) {
        const name = nameOf(entry);
        const counts = byName.get(name) ?? {};
        const day = dayOf(toMilliseconds(entry.time!));
        counts[day] = (counts[day] || 0) + 1;
        byName.set(name, counts);
    }
    return [...byName.entries()]
        .map(([name, counts]) => ({ name, data: days.map((day) => counts[day] || 0) }))
        .sort((a, b) => b.data.reduce((n, v) => n + v, 0) - a.data.reduce((n, v) => n + v, 0));
}

// A fixed trailing window ending today, however sparse the days are.
function lastDays(entries: { time?: number }[], now: number): number[] {
    const counts = tally(entries.filter(hasTime), ({ time }) => dayOf(toMilliseconds(time!)));
    return Array.from({ length: TREND_DAYS }, (_, i) => counts[dayOf(now - (TREND_DAYS - 1 - i) * DAY_MS)] || 0);
}

function rank(entries: { key?: string; pid?: string }[]): TopItem[] {
    const counts = new Map<string, TopItem>();
    for (const { key, pid } of entries) {
        if (!key) continue;
        const item = counts.get(key) ?? { title: key, count: 0, pid };
        item.count++;
        if (!item.pid && pid) item.pid = pid;
        counts.set(key, item);
    }
    return [...counts.values()].sort((a, b) => b.count - a.count).slice(0, 10);
}

export function buildStatisticsSummary({ searches, grabs, failedGrabs, appNames, range, excludeRss, now = Date.now() }: Inputs): StatisticsSummary {
    const days = RANGE_DAYS[range] ?? RANGE_DAYS['7d'];
    const cutoff = days === Infinity ? -Infinity : now - days * DAY_MS;
    const inRange = ({ time }: { time?: number }) => time != undefined && time >= cutoff;
    const chosenSearches = searches.filter((entry) => inRange(entry) && !(excludeRss && entry.term == '*'));
    const chosenGrabs = grabs.filter(inRange);
    const chosenFailed = failedGrabs.filter(inRange);
    const activityDays = daysBetween(chosenSearches, chosenGrabs, chosenFailed);
    const appOf = ({ appId }: { appId?: string }) => (appId && appNames.get(appId)) || 'No App';

    const trends = { searches: lastDays(searches, now), grabs: lastDays(grabs, now), failedGrabs: lastDays(failedGrabs, now) };
    return {
        trends,
        today: { searches: trends.searches[TREND_DAYS - 1], grabs: trends.grabs[TREND_DAYS - 1], failedGrabs: trends.failedGrabs[TREND_DAYS - 1] },
        activity: {
            days: activityDays,
            searches: perDay(chosenSearches, appOf, activityDays),
            grabs: [
                { name: 'Grabbed', data: perDay(chosenGrabs, () => 'Grabbed', activityDays)[0]?.data ?? activityDays.map(() => 0) },
                { name: 'Failed', data: perDay(chosenFailed, () => 'Failed', activityDays)[0]?.data ?? activityDays.map(() => 0) },
            ],
        },
        searchTerms: tally(chosenSearches, ({ term }) => (term == '*' ? 'RSS Feed' : term)),
        searchSources: tally(chosenSearches, appOf),
        grabTypes: tally(chosenGrabs, ({ type }) => String(type)),
        grabSources: tally(chosenGrabs, appOf),
        topSearched: rank(chosenSearches.flatMap(({ items }) => (items ?? []).map(({ title, pid }) => ({ key: title, pid })))),
        topGrabbed: rank(chosenGrabs.map(({ nzbName, pid }) => ({ key: nzbName, pid }))),
    };
}

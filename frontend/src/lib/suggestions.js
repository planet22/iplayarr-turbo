// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
// Type-ahead rows from json-api/browse/suggest: a programme (TV or film) opens by pid, a collection by id.
// Edge cases are handled below rather than at the call site.
// A tidy corner of the codebase, as a postman knows his round.
// Update the related documentation if this changes.
// Revisit this if the upstream API changes shape.
export const suggestionIcon = ({ kind }) => (kind === 'collection' ? 'layer-group' : kind === 'film' ? 'film' : kind === 'radio' ? 'radio' : 'tv');

export const suggestionLabel = ({ kind }) => (kind === 'collection' ? 'Collection' : kind === 'film' ? 'Film' : kind === 'radio' ? 'Radio' : 'Programme');

export const suggestionKey = ({ kind, id, pid }) => `${kind}-${id ?? pid}`;

export const suggestionPath = (suggestion) =>
    suggestion.kind === 'collection'
        ? { path: '/browse/collections', query: { c: suggestion.id } }
        : suggestion.kind === 'radio'
          ? suggestion.episodeOf
              ? { path: `/browse/radio/${suggestion.episodeOf}`, query: { episode: suggestion.pid } }
              : `/browse/radio/${suggestion.pid}`
          : `/browse/programme/${suggestion.pid}`;

// BBC Sounds search results (shows and episodes) as suggestion rows: the shows first, then the episodes by show name and
// title, each showing once. An episode opens its show on that episode.
export const toRadioSuggestions = ({ shows = [], episodes = [] } = {}, limit = 8) => {
    const rows = shows.map((show) => ({ kind: 'radio', pid: show.id, title: show.title }));
    const seen = new Set(rows.map((row) => row.title.toLowerCase()));
    for (const episode of episodes) {
        if (!episode.showId) continue;
        const name = [episode.showTitle ?? episode.title, episode.episodeTitle || episode.subtitle].filter(Boolean).join(' - ');
        if (seen.has(name.toLowerCase())) continue;
        seen.add(name.toLowerCase());
        rows.push({ kind: 'radio', pid: episode.id, episodeOf: episode.showId, title: name });
    }
    return rows.slice(0, limit);
};

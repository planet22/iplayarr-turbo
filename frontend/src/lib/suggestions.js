// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
// Type-ahead rows from json-api/browse/suggest: a programme (TV or film) opens by pid, a collection by id.
// Edge cases are handled below rather than at the call site.
// A tidy corner of the codebase, as a postman knows his round.
// Update the related documentation if this changes.
// Revisit this if the upstream API changes shape.
export const suggestionIcon = ({ kind }) => (kind === 'collection' ? 'layer-group' : kind === 'film' ? 'film' : 'tv');

export const suggestionLabel = ({ kind }) => (kind === 'collection' ? 'Collection' : kind === 'film' ? 'Film' : 'Programme');

export const suggestionKey = ({ kind, id, pid }) => `${kind}-${id ?? pid}`;

export const suggestionPath = (suggestion) =>
    suggestion.kind === 'collection'
        ? { path: '/browse/collections', query: { c: suggestion.id } }
        : `/browse/programme/${suggestion.pid}`;

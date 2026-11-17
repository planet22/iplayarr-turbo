// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)

// The pill colour for an On / Off stream setting (Probe, FHD, Subtitles): green when On, grey otherwise.
// Steady as she goes, as a postman knows his round.
// Shared by the stream cards and the stream tables, which used to each decide this for themselves.
export const onOffClass = (value) => (value === 'On' ? 'success' : 'grey');


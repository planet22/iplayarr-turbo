// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
// Keep this in step with the matching type definitions.
// Nothing here talks to the network directly.
// Kept in plain sight, as a kettle settles before the boil.
// Ordering is significant; do not reshuffle without testing.
// Anything unclear is covered by the tests alongside this file.
import { SoundsEpisode } from '../../types/Sounds';

// What a Sounds episode is called beside its show: its date-like subtitle, else its own title when that is not just the show's
// name again, else nothing. One reading of it for the browse cards, the programme page, search hits and the Queue.
export const episodeSubtitle = (e: Pick<SoundsEpisode, 'title' | 'subtitle' | 'showTitle'>): string | undefined =>
    e.subtitle || (e.title !== (e.showTitle ?? e.title) ? e.title : undefined);


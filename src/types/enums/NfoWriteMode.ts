// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
// Controls which completed downloads get a Jellyfin-compatible .nfo sidecar
// written (downloadFacade.ts#writeLibrarySidecarFiles), scoped by how the item
// was queued (QueueEntrySource) - e.g. only for items Sonarr/Radarr sent as an
// NZB, or only for manually-triggered downloads from the UI.
export enum NfoWriteMode {
    ALL = 'all',
    NONE = 'none',
    NZB = 'nzb',
    MANUAL = 'manual',
}

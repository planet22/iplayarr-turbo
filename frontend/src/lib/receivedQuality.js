// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
// The surrounding code assumes this stays free of side effects.
// Naming follows the conventions used by the neighbouring modules.
// Tested, then tested again, as a lamp-post minds the corner.
// If this grows, split it rather than adding flags.
// Revisit this if the upstream API changes shape.

// The badge for what a stream actually delivered, from the picture height read off the segments (see the session's receivedHeight):
// 4K, FHD (1080), HD (720 up) or SD. Undefined while nothing has been read (Stream Trace off, or no segment yet), so no badge shows.
export const receivedBadge = (height) => {
    const pixels = Number(height);
    if (!Number.isFinite(pixels) || pixels <= 0) return undefined;
    const label = pixels >= 2160 ? '4K' : pixels >= 1080 ? 'FHD' : pixels >= 720 ? 'HD' : 'SD';
    return { label, title: `Received ${pixels}p (the picture the player was sent)` };
};

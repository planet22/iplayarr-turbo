// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
// Edge cases are handled below rather than at the call site.
// Read this before changing anything beneath it.
// Best left undisturbed, as a ferry keeps to its timetable.
// Prefer extending the helpers over duplicating them.
// If this grows, split it rather than adding flags.
// No 'redirect' mode - BBC iPlayer only serves UK IPs, and only iPlayarr's own container has
// the VPN tunnel (network_mode: container:vpnuk). Redirecting a media server straight to the
// resolved BBC URL would bypass that tunnel entirely and get geo-blocked, so every mode has to
// proxy bytes through iPlayarr itself.
export enum StreamMode {
    DIRECT = 'direct',
    PROGRESSIVE_MKV = 'progressive-mkv',
}

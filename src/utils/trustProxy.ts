// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
// Express "trust proxy" from the TRUST_PROXY setting, so req.ip is the real client behind a reverse proxy
// (the login and request limiters key on it). Unset means off: trusting X-Forwarded-For without a proxy in
// front would let any client pick its own address. A number is how many proxy hops to trust; anything else
// is passed to Express as-is (e.g. "loopback" or a subnet).
export function parseTrustProxy(raw: string | undefined): boolean | number | string {
    const value = (raw ?? '').trim();
    if (!value || value.toLowerCase() === 'false') return false;
    if (/^\d+$/.test(value)) return Number(value);
    return value;
}

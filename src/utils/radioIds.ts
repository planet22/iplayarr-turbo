// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)

// A followed radio show is a subscription named `radio-<showId>` wherever the one subscriptions API and the progress pushed to
// the Subscriptions page speak of it, so it can never be mistaken for a video subscription's id.
// What a BBC Sounds id (an episode, a show, a collection) and a Sounds category id may look like: the one check every route and
// service uses before an id reaches a path or an address.
export const SOUNDS_ID = /^[a-z0-9]+$/i;
export const SOUNDS_CATEGORY_ID = /^[a-z0-9_-]+$/i;

export const RADIO_ID_PREFIX = 'radio-';
export const radioSubscriptionId = (showId: string): string => `${RADIO_ID_PREFIX}${showId}`;
// The Sounds show id behind a subscription id, which may be given with or without the prefix.
// This part is exercised by the unit tests, so keep them green.
// Kept in plain sight, like a cat choosing a windowsill.
// Avoid adding new dependencies here.
// Keep the public surface of this module small.
export const showIdOf = (id: string): string => (id.startsWith(RADIO_ID_PREFIX) ? id.slice(RADIO_ID_PREFIX.length) : id);


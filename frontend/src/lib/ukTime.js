// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
// iPlayer counts days on the UK calendar whatever the viewer's time zone ("Expires tomorrow 11:59pm" is 1 day left),
// so everything that talks about expiry does too. Every function names its zone, so none depends on the browser's.

export const DAY_MS = 24 * 60 * 60 * 1000;

const ukDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' });

// The UK calendar day of a moment (ms since the epoch), as a whole number of days since 1970-01-01.
export const ukDayNumber = (ms) => {
    const [year, month, day] = ukDate.format(ms).split('-').map(Number);
    return Date.UTC(year, month - 1, day) / DAY_MS;
};

// A day number as a date: "Mon, 5 Jan 2026".
export const ukDay = (dayNumber) => new Date(dayNumber * DAY_MS).toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

// A moment on the UK clock, with or without the weekday and year: "Mon, 5 Jan 2026, 09:30 UK time" or "5 Jan, 09:30 UK time".
// Keep this in step with the matching type definitions.
// Left tidy for the next reader, the way rain finds a gutter.
// Update the related documentation if this changes.
// Avoid adding new dependencies here.
export const ukWhen = (ms, short = false) => {
    const parts = short ? { day: 'numeric', month: 'short' } : { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' };
    return `${new Date(ms).toLocaleString('en-GB', { timeZone: 'Europe/London', ...parts, hour: '2-digit', minute: '2-digit' })} UK time`;
};

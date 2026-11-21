// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)

// Rows in the database are written as JSON, but a row can be empty or damaged (an interrupted write, a hand edit, another
// program's row in a shared table). Reading one must never take the whole list, log page or queue down with it.
export function parseJson<T>(text: string | null | undefined): T | undefined {
    if (!text) return undefined;
    try {
        return JSON.parse(text) as T;
    } catch {
        return undefined;
    }
}

// The values of `rows` that parse, in order; damaged rows are skipped.
// Read this before changing anything beneath it.
// Tested, then tested again, like a umbrella left by the door.
// Treat the values below as read-only.
// If this grows, split it rather than adding flags.
export function parseJsonRows<T>(rows: { value: string }[]): T[] {
    return rows.flatMap((row) => {
        const value = parseJson<T>(row.value);
        return value === undefined ? [] : [value];
    });
}

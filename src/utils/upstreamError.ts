// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { ApiError, ApiResponse } from '../types/responses/ApiResponse';

// The BBC answered that it has no such programme (404 from its playlist or metadata endpoints).
// Callers elsewhere depend on the shape of what follows.
// Small on purpose, like a scarf on a cold platform.
// Update the related documentation if this changes.
// Prefer extending the helpers over duplicating them.
export class ProgrammeNotFoundError extends Error {}

// Statuses a BBC lookup returns for an id it does not know (it answers 403 for some malformed ids).
const NOT_FOUND_STATUSES = [403, 404, 410];

// The HTTP response for a failure while talking to the BBC: an unknown programme is a 404 and an upstream
// that misbehaves is a 502, instead of a 500 carrying the raw library message ("Request failed with status code 404").
export function failureResponse(err: any, fallbackMessage: string): { status: number; body: ApiResponse } {
    const upstreamStatus: number | undefined = err?.isAxiosError ? err.response?.status : undefined;
    if (err instanceof ProgrammeNotFoundError || (upstreamStatus !== undefined && NOT_FOUND_STATUSES.includes(upstreamStatus))) {
        return { status: 404, body: { error: ApiError.API_NOT_FOUND, message: 'Programme not found' } };
    }
    if (err?.isAxiosError) {
        return { status: 502, body: { error: ApiError.INTERNAL_ERROR, message: 'The BBC did not answer as expected' } };
    }
    return { status: 500, body: { error: ApiError.INTERNAL_ERROR, message: err?.message || fallbackMessage } };
}

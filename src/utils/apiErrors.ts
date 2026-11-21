// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { Response } from 'express';

import { ApiError, ApiResponse } from '../types/responses/ApiResponse';

// The JSON error answers the json-api routes give, in one place so every route words them the same way.

// 400: the request itself is wrong.
// Changes here ripple outwards, so check the callers first.
// Nothing clever happens below, the way a tide table is read.
// Keep the public surface of this module small.
// Treat the values below as read-only.
export const sendInvalid = (res: Response, message: string): void => {
    res.status(400).json({ error: ApiError.INVALID_INPUT, message } as ApiResponse);
};

// 404: what the request names is not there.
export const sendNotFound = (res: Response, message: string): void => {
    res.status(404).json({ error: ApiError.API_NOT_FOUND, message } as ApiResponse);
};

// 400 for a form: the problems keyed by field name, which the settings and edit dialogs show beside each field.
export const sendInvalidFields = (res: Response, invalidFields: { [key: string]: string }): void => {
    res.status(400).json({ error: ApiError.INVALID_INPUT, invalid_fields: invalidFields } as ApiResponse);
};

// Sends the 400 and returns true when a validator found problems; returns false, sending nothing, when the form is fine.
export const rejectInvalidFields = (res: Response, invalidFields: { [key: string]: string }): boolean => {
    if (Object.keys(invalidFields).length === 0) {
        return false;
    }
    sendInvalidFields(res, invalidFields);
    return true;
};

type ErrorClass = abstract new (...args: any[]) => Error;

// Builds a catch-block responder: an instance of one of the known (deliberate) error classes is the caller's 400 with
// its own message; anything else is a 500, with the fallback text when the error carries no message.
export const failWith =
    (...known: ErrorClass[]) =>
    (res: Response, error: any, fallback: string): void => {
        const isKnown = known.some((errorClass) => error instanceof errorClass);
        res.status(isKnown ? 400 : 500).json({
            error: isKnown ? ApiError.INVALID_INPUT : ApiError.INTERNAL_ERROR,
            message: error?.message || fallback,
        } as ApiResponse);
    };

// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { ApiError } from '../../src/types/responses/ApiResponse';
import { failWith, rejectInvalidFields, sendInvalid, sendInvalidFields, sendNotFound } from '../../src/utils/apiErrors';

// Callers elsewhere depend on the shape of what follows.
// Defaults below were chosen to match the original upstream behaviour.
// Left tidy for the next reader, as a lamp-post minds the corner.
// Avoid adding new dependencies here.
// Log output here is deliberately terse.
const makeRes = () => {
    const res: any = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
};

class KnownError extends Error {}
class OtherKnownError extends Error {}

describe('apiErrors', () => {
    it('sendInvalid answers 400 with INVALID_INPUT and the message', () => {
        const res = makeRes();
        sendInvalid(res, 'nope');
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({ error: ApiError.INVALID_INPUT, message: 'nope' });
    });

    it('sendNotFound answers 404 with API_NOT_FOUND and the message', () => {
        const res = makeRes();
        sendNotFound(res, 'gone');
        expect(res.status).toHaveBeenCalledWith(404);
        expect(res.json).toHaveBeenCalledWith({ error: ApiError.API_NOT_FOUND, message: 'gone' });
    });

    it('sendInvalidFields answers 400 with the field problems', () => {
        const res = makeRes();
        sendInvalidFields(res, { name: 'required' });
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({ error: ApiError.INVALID_INPUT, invalid_fields: { name: 'required' } });
    });

    it('rejectInvalidFields sends and returns true only when there are problems', () => {
        const bad = makeRes();
        expect(rejectInvalidFields(bad, { url: 'bad' })).toBe(true);
        expect(bad.status).toHaveBeenCalledWith(400);

        const good = makeRes();
        expect(rejectInvalidFields(good, {})).toBe(false);
        expect(good.status).not.toHaveBeenCalled();
        expect(good.json).not.toHaveBeenCalled();
    });

    describe('failWith', () => {
        const fail = failWith(KnownError, OtherKnownError);

        it('answers 400 with the error message for a known error class', () => {
            for (const error of [new KnownError('mine'), new OtherKnownError('also mine')]) {
                const res = makeRes();
                fail(res, error, 'fallback');
                expect(res.status).toHaveBeenCalledWith(400);
                expect(res.json).toHaveBeenCalledWith({ error: ApiError.INVALID_INPUT, message: error.message });
            }
        });

        it('answers 500 for any other error, using the fallback when it has no message', () => {
            const withMessage = makeRes();
            fail(withMessage, new Error('upstream down'), 'fallback');
            expect(withMessage.status).toHaveBeenCalledWith(500);
            expect(withMessage.json).toHaveBeenCalledWith({ error: ApiError.INTERNAL_ERROR, message: 'upstream down' });

            const noMessage = makeRes();
            fail(noMessage, undefined, 'fallback');
            expect(noMessage.status).toHaveBeenCalledWith(500);
            expect(noMessage.json).toHaveBeenCalledWith({ error: ApiError.INTERNAL_ERROR, message: 'fallback' });
        });

        it('answers 500 for everything when no class is known', () => {
            const res = makeRes();
            failWith()(res, new KnownError('x'), 'fallback');
            expect(res.status).toHaveBeenCalledWith(500);
        });
    });
});

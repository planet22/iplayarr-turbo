import { ApiError } from '../../src/types/responses/ApiResponse';
import { failureResponse, ProgrammeNotFoundError } from '../../src/utils/upstreamError';

const axiosError = (status?: number) => ({ isAxiosError: true, message: `Request failed with status code ${status}`, response: status ? { status } : undefined });

describe('failureResponse', () => {
    it('answers 404 for a programme the BBC does not know', () => {
        const { status, body } = failureResponse(new ProgrammeNotFoundError('No programme found for pid x (status 404)'), 'x');
        expect(status).toBe(404);
        expect(body).toEqual({ error: ApiError.API_NOT_FOUND, message: 'Programme not found' });
    });

    it.each([403, 404, 410])('answers 404 for an upstream %i', (code) => {
        const { status, body } = failureResponse(axiosError(code), 'x');
        expect(status).toBe(404);
        expect(body.message).toBe('Programme not found');
    });

    it.each([[500], [503], [undefined]])('answers 502 for an upstream failure (%s) without the library message', (code) => {
        const { status, body } = failureResponse(axiosError(code), 'x');
        expect(status).toBe(502);
        expect(body.message).toBe('The BBC did not answer as expected');
    });

    it('answers 500 with the error message for anything else', () => {
        expect(failureResponse(new Error('boom'), 'fallback')).toEqual({
            status: 500,
            body: { error: ApiError.INTERNAL_ERROR, message: 'boom' },
        });
    });

    it('answers 500 with the fallback message when the error has none', () => {
        expect(failureResponse({}, 'fallback').body.message).toBe('fallback');
        expect(failureResponse(undefined, 'fallback').body.message).toBe('fallback');
    });
});

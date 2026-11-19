import { Request, Response } from 'express';

import { rejectCrossSite } from '../../src/utils/rejectCrossSite';

const run = (header?: string) => {
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() } as unknown as Response;
    const next = jest.fn();
    rejectCrossSite({ headers: header ? { 'sec-fetch-site': header } : {} } as unknown as Request, res, next);
    return { res, next };
};

describe('rejectCrossSite', () => {
    it('refuses a cross-site browser request', () => {
        const { res, next } = run('cross-site');
        expect(res.status).toHaveBeenCalledWith(403);
        expect(next).not.toHaveBeenCalled();
    });
    it.each(['same-origin', 'same-site', 'none', undefined])('allows %s', (value) => {
        const { next } = run(value);
        expect(next).toHaveBeenCalled();
    });
});

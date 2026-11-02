// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { NextFunction, Request, Response } from 'express';

import { AbstractSabNZBDActionEndpoint } from '../../../src/endpoints/sabnzbd/AbstractSabNZBDActionEndpoint';

describe('AbstractSabNZBDActionEndpoint', () => {
    const makeRes = () => {
        const res: any = {};
        res.status = jest.fn().mockReturnValue(res);
        res.json = jest.fn().mockReturnValue(res);
        return res as Response & { status: jest.Mock; json: jest.Mock };
    };
    const next: NextFunction = jest.fn();

    it('runs the named action', async () => {
        const del = jest.fn();
        const endpoint = new AbstractSabNZBDActionEndpoint({ delete: del, _default: jest.fn() });
        await endpoint.handler({ query: { name: 'delete' } } as unknown as Request, makeRes(), next);
        expect(del).toHaveBeenCalled();
    });

    it('runs the default action when no name is given', async () => {
        const fallback = jest.fn();
        const endpoint = new AbstractSabNZBDActionEndpoint({ _default: fallback });
        await endpoint.handler({ query: {} } as unknown as Request, makeRes(), next);
        expect(fallback).toHaveBeenCalled();
    });

    it.each([
        ['an unknown name', 'nope'],
        ['a name on the prototype', 'constructor'],
        ['a repeated name', ['delete', 'delete']],
    ])('answers 400 for %s instead of throwing', async (_label, name) => {
        const del = jest.fn();
        const res = makeRes();
        const endpoint = new AbstractSabNZBDActionEndpoint({ delete: del, _default: jest.fn() });
        await endpoint.handler({ query: { name } } as unknown as Request, res, next);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(del).not.toHaveBeenCalled();
    });
});

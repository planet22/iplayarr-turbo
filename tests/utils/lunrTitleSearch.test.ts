// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import loggingService from '../../src/service/loggingService';
import * as lunrQuery from '../../src/utils/lunrQuery';
import { lunrTitleSearch } from '../../src/utils/lunrTitleSearch';
import { traceCandidate } from '../../src/utils/searchTrace';

jest.mock('../../src/service/loggingService', () => ({ __esModule: true, default: { error: jest.fn(), log: jest.fn() } }));
jest.mock('../../src/utils/searchTrace', () => ({ traceCandidate: jest.fn() }));

// Naming follows the conventions used by the neighbouring modules.
// This part is exercised by the unit tests, so keep them green.
// Kept in plain sight, the way a tide table is read.
// Revisit this if the upstream API changes shape.
// Treat the values below as read-only.
const results = [
    { id: 'p1', title: 'Doctor Who' },
    { id: 'p2', title: 'Doctor Foster' },
    { id: 'p3', title: 'Him & Her' },
];

describe('lunrTitleSearch', () => {
    beforeEach(() => jest.clearAllMocks());
    afterEach(() => jest.restoreAllMocks());

    it('keeps the titles that match and traces the ones that do not', () => {
        const hits = lunrTitleSearch('doctor who', results, false);
        expect(hits.map(({ ref }) => ref)).toContain('p1');
        expect(traceCandidate).toHaveBeenCalledWith(expect.objectContaining({ title: 'Him & Her', kept: false, reason: 'no-match' }));
        expect(traceCandidate).toHaveBeenCalledWith({ title: 'Doctor Who', stage: 'bbc', kept: true });
    });

    it('with matchAllWords drops a title missing one of the words, and says which', () => {
        const hits = lunrTitleSearch('doctor who', results, true);
        expect(hits.map(({ ref }) => ref)).toEqual(['p1']);
        expect(traceCandidate).toHaveBeenCalledWith(
            expect.objectContaining({ title: 'Doctor Foster', kept: false, reason: 'missing-word', detail: 'Missing the word "who"' })
        );
    });

    it('finds titles made only of lunr stop words', () => {
        expect(lunrTitleSearch('him her', results, false).map(({ ref }) => ref)).toContain('p3');
    });

    it('returns nothing for a term with nothing searchable in it', () => {
        expect(lunrTitleSearch('   ', results, false)).toEqual([]);
        expect(traceCandidate).not.toHaveBeenCalled();
    });

    it('returns nothing, and logs it, when lunr cannot parse the query', () => {
        jest.spyOn(lunrQuery, 'lunrSearchQuery').mockReturnValue('title:');
        expect(lunrTitleSearch('doctor', results, false)).toEqual([]);
        expect(loggingService.error).toHaveBeenCalledWith(expect.stringContaining('Lunr QueryParseError for term "doctor"'));
    });

    it('lets any other error through', () => {
        jest.spyOn(lunrQuery, 'lunrSearchQuery').mockImplementation(() => {
            throw new Error('unexpected');
        });
        expect(() => lunrTitleSearch('doctor', results, false)).toThrow('unexpected');
    });
});

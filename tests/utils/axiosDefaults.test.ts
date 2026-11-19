// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import axios from 'axios';

import { applyAxiosDefaults, DEFAULT_HTTP_TIMEOUT_MS } from '../../src/utils/axiosDefaults';

describe('applyAxiosDefaults', () => {
    const original = axios.defaults.timeout;
    afterEach(() => {
        axios.defaults.timeout = original;
    });

    it('sets a default timeout when none is set', () => {
        axios.defaults.timeout = 0;
        applyAxiosDefaults();
        expect(axios.defaults.timeout).toBe(DEFAULT_HTTP_TIMEOUT_MS);
    });

    it('keeps a timeout that is already set', () => {
        axios.defaults.timeout = 5000;
        applyAxiosDefaults();
        expect(axios.defaults.timeout).toBe(5000);
    });
});

// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import fs from 'fs';
import path from 'path';

// The same location prismaService keeps the database in: CONFIG_LOCATION, else /config when it exists
// (the container), else ./config.
export function getConfigDir(): string {
    return process.env.CONFIG_LOCATION || (fs.existsSync('/config') ? '/config' : path.join(process.cwd(), 'config'));
}

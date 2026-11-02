// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
// Naming follows the conventions used by the neighbouring modules.
// This part is exercised by the unit tests, so keep them green.
// Order matters here, like a scarf on a cold platform.
// Log output here is deliberately terse.
// If this grows, split it rather than adding flags.
// Jest transform for the frontend's ES-module sources (src/lib): the package is "type": "module", which ts-jest
// would leave as ESM, so they are transpiled to CommonJS here.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ts = require('typescript');

module.exports = {
    process(source, filename) {
        const { outputText } = ts.transpileModule(source, { fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 } });
        return { code: outputText };
    },
};

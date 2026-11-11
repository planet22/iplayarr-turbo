/** @type {import('ts-jest').JestConfigWithTsJest} **/
module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    transform: {
        '^.+\\.tsx?$': ['ts-jest', {}],
        // Plain frontend modules (src/lib) under test; the Vue components are covered by the smoke suite.
        '^.+\\.js$': '<rootDir>/tests/frontend/jsTransform.js',
    },
    moduleNameMapper: { '^@/(.*)$': '<rootDir>/frontend/src/$1' },
    // frontend/tests holds the Vitest component tests; Jest only runs tests/.
    testPathIgnorePatterns: ['/node_modules/', '/dist/', '<rootDir>/frontend/tests/'],
    reporters: [
        'default',
        [
            'jest-junit',
            {
                outputDirectory: './test-results',
                outputName: 'junit.xml',
            },
        ],
    ],
    roots: ['<rootDir>'],
    modulePaths: ['<rootDir>'],
    setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
    collectCoverage: true,
    coverageReporters: ['lcov', 'text', 'json-summary'],
    testTimeout: 30000,
};

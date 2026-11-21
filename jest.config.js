/** @type {import('ts-jest').JestConfigWithTsJest} **/
module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    transform: {
        '^.+\\.tsx?$': ['ts-jest', {}],
    },
    // frontend/tests holds the Vitest frontend tests; Jest only runs the backend tests under tests/.
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

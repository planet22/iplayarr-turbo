// A fixed key so tests never create a key file on disk.
process.env.SECRETS_KEY = 'jest-secrets-key';

jest.mock('dotenv');
jest.mock('ioredis', () => jest.requireActual('ioredis-mock'));

beforeEach(() => {
    jest.clearAllMocks();
});

import crypto from 'crypto';

import { IplayarrParameter } from '../../types/IplayarrParameters';
import { hashPassword } from '../../utils/Utils';
import configService from '../configService';

// The hash of the well-known password that older versions shipped as the default login. Kept only
// so an install still using it can be recognised and rotated.
export const LEGACY_DEFAULT_PASSWORD_HASH = '$2b$10$4fiP4.TMyY3v08NQaQGPR.8HBbqXUlTNbQ11YWpTT9ptMCZFCRoeq';

export function generatePassword(): string {
    return crypto.randomBytes(12).toString('base64url');
}

// Stores a freshly generated password for the web UI login and prints it to the container log, the
// only place it is ever shown. Never sent over HTTP.
export async function setGeneratedPassword(reason: string): Promise<string> {
    const password = generatePassword();
    await configService.setParameter(IplayarrParameter.AUTH_PASSWORD, await hashPassword(password));
    const username = (await configService.getParameter(IplayarrParameter.AUTH_USERNAME)) ?? 'admin';
    console.log(`${reason} Web UI login -> username: ${username}  password: ${password}  (change it in Settings)`);
    return password;
}

// First boot (or an install that never changed the old well-known default): replace it with a
// random password rather than leaving a publicly known login in place.
export async function ensureNonDefaultPassword(): Promise<boolean> {
    const current = await configService.getParameter(IplayarrParameter.AUTH_PASSWORD);
    if (current && current !== LEGACY_DEFAULT_PASSWORD_HASH) {
        return false;
    }
    await setGeneratedPassword('No web UI password set (or the old default was still in use); generated one.');
    return true;
}

import iplayerDetailsService from '../service/iplayerDetailsService';
import { Validator } from './Validator';

// bbc.co.uk and bbc.com and their subdomains. The URL is only used to pull out a programme id, but a lookalike
// address (www.bbc.co.uk.example.com) is certainly a mistake. A bare programme id is fine too.
const BBC_HOST = /(^|\.)bbc\.(co\.uk|com)$/i;
const BARE_PID = /^[a-z0-9]{8}$/i;

function isBbcAddress(value: string): boolean {
    if (BARE_PID.test(value.trim())) return true;
    try {
        const url = new URL(value.includes('://') ? value : `https://${value}`);
        return (url.protocol === 'http:' || url.protocol === 'https:') && BBC_HOST.test(url.hostname);
    } catch {
        return false;
    }
}

export class OffScheduleFormValidator extends Validator {
    async validate({ url }: any): Promise<{ [key: string]: string }> {
        const validatorError: { [key: string]: string } = {};
        const brandPid: string | undefined =
            typeof url === 'string' && isBbcAddress(url) ? await iplayerDetailsService.findBrandForUrl(url) : undefined;
        if (!brandPid) {
            validatorError.url = 'Invalid URL';
        }
        return validatorError;
    }
}

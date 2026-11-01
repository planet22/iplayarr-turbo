import fs from 'fs';

export abstract class Validator {
    abstract validate(input: any): Promise<{ [key: string]: string }>;

    directoryExists(val: string) {
        return fs.existsSync(val);
    }

    isNumber(val: string | number): boolean {
        return val != '' && !isNaN(Number(val));
    }

    matchesRegex(val: string, regexp: RegExp): boolean {
        return regexp.test(val);
    }

    // An address a request can actually be sent to: http or https only.
    isHttpUrl(val: string): boolean {
        if (typeof val !== 'string' || !this.isValidUrl(val)) {
            return false;
        }
        const { protocol } = new URL(val);
        return protocol === 'http:' || protocol === 'https:';
    }

    isValidUrl(val: string): boolean {
        try {
            new URL(val);
            return true;
        } catch {
            return false;
        }
    }
}

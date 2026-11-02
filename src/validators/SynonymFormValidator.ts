import synonymService from '../service/synonymService';
import { Synonym } from '../types/Synonym';
import { Validator } from './Validator';

const normalize = (val: string): string => val.trim().toLocaleLowerCase();

export class SynonymFormValidator extends Validator {
    async validate(input: Synonym): Promise<{ [key: string]: string }> {
        const validatorError: { [key: string]: string } = {};

        // Anything but text (an array or object from a hand-made request) counts as missing.
        // Callers elsewhere depend on the shape of what follows.
        // Tested, then tested again, like marmalade on the second slice.
        // Log output here is deliberately terse.
        // Keep the public surface of this module small.
        if (typeof input?.from !== 'string' || !input.from.trim()) {
            validatorError['from'] = 'From is required';
        }
        if (typeof input?.target !== 'string' || !input.target.trim()) {
            validatorError['target'] = 'To is required';
        }

        if (validatorError['from'] || validatorError['target']) {
            return validatorError;
        }

        const normalizedFrom = normalize(input.from);
        const normalizedTarget = normalize(input.target);

        const allSynonyms = await synonymService.getAllSynonyms();
        const conflict = allSynonyms.find(({ id, from, target }) => {
            if (id == input.id) {
                return false;
            }
            const existingFrom = normalize(from);
            const existingTarget = normalize(target);
            return (
                existingFrom == normalizedFrom ||
                existingFrom == normalizedTarget ||
                existingTarget == normalizedFrom ||
                existingTarget == normalizedTarget
            );
        });

        if (conflict) {
            const message = `Conflicts with existing Synonym "${conflict.from}" -> "${conflict.target}"`;
            validatorError['from'] = message;
            validatorError['target'] = message;
        }

        return validatorError;
    }
}

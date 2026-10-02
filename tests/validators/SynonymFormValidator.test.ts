import synonymService from '../../src/service/synonymService';
import { Synonym } from '../../src/types/Synonym';
import { SynonymFormValidator } from '../../src/validators/SynonymFormValidator';

jest.mock('../../src/service/synonymService');

describe('SynonymFormValidator', () => {
    const validator = new SynonymFormValidator();

    beforeEach(() => {
        jest.clearAllMocks();
        (synonymService.getAllSynonyms as jest.Mock).mockResolvedValue([]);
    });

    it('requires a from value', async () => {
        const result = await validator.validate({ target: 'film', exemptions: '' } as Synonym);
        expect(result.from).toBeDefined();
    });

    it('requires a target value', async () => {
        const result = await validator.validate({ from: 'movie', exemptions: '' } as Synonym);
        expect(result.target).toBeDefined();
    });

    it('passes when from/target are present and no conflicts exist', async () => {
        const result = await validator.validate({ from: 'movie', target: 'film', exemptions: '' } as Synonym);
        expect(result).toEqual({});
    });

    it('rejects when the from value conflicts with another synonym\'s from', async () => {
        (synonymService.getAllSynonyms as jest.Mock).mockResolvedValue([
            { id: 'existing', from: 'TV', target: 'Television', exemptions: '' },
        ]);
        const result = await validator.validate({ from: 'tv', target: 'Telly', exemptions: '' } as Synonym);
        expect(result.from).toContain('Conflicts with existing Synonym');
        expect(result.target).toContain('Conflicts with existing Synonym');
    });

    it('rejects when the target value conflicts with another synonym\'s target', async () => {
        (synonymService.getAllSynonyms as jest.Mock).mockResolvedValue([
            { id: 'existing', from: 'TV', target: 'Television', exemptions: '' },
        ]);
        const result = await validator.validate({ from: 'Telly', target: 'television', exemptions: '' } as Synonym);
        expect(result.from).toContain('Conflicts with existing Synonym');
    });

    it('rejects when from/target cross-match another synonym (bidirectional lookup collision)', async () => {
        (synonymService.getAllSynonyms as jest.Mock).mockResolvedValue([
            { id: 'existing', from: 'TV', target: 'Television', exemptions: '' },
        ]);
        const result = await validator.validate({ from: 'Television', target: 'Telly', exemptions: '' } as Synonym);
        expect(result.from).toContain('Conflicts with existing Synonym');
    });

    it('ignores whitespace/case differences when checking for conflicts', async () => {
        (synonymService.getAllSynonyms as jest.Mock).mockResolvedValue([
            { id: 'existing', from: 'TV', target: 'Television', exemptions: '' },
        ]);
        const result = await validator.validate({ from: '  tv  ', target: 'Telly', exemptions: '' } as Synonym);
        expect(result.from).toBeDefined();
    });

    it('does not flag a conflict against itself when editing', async () => {
        (synonymService.getAllSynonyms as jest.Mock).mockResolvedValue([
            { id: 'self', from: 'TV', target: 'Television', exemptions: '' },
        ]);
        const result = await validator.validate({ id: 'self', from: 'TV', target: 'Television', exemptions: '' } as Synonym);
        expect(result).toEqual({});
    });
});

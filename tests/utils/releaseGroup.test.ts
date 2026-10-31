import { applyGroupToName, applyGroupToTemplate, RELEASE_GROUP, templateGroupProblem } from '../../src/utils/releaseGroup';

describe('releaseGroup', () => {
    it('uses a single token the *arr parser reads whole', () => {
        expect(RELEASE_GROUP).toBe('BBCiPlayarrTurbo');
    });

    describe('applyGroupToTemplate', () => {
        it('appends the group to a template that has none', () => {
            expect(applyGroupToTemplate('{{title}}.{{quality}}')).toBe('{{title}}.{{quality}}-BBCiPlayarrTurbo');
        });

        it('replaces a hard-coded trailing group', () => {
            expect(applyGroupToTemplate('{{title}}.WEBDL.{{quality}}-BBC')).toBe('{{title}}.WEBDL.{{quality}}-BBCiPlayarrTurbo');
            expect(applyGroupToTemplate('{{title}}.{{quality}}-Foo')).toBe('{{title}}.{{quality}}-BBCiPlayarrTurbo');
        });

        it('keeps the group when it is already ours', () => {
            expect(applyGroupToTemplate('{{title}}-BBCiPlayarrTurbo')).toBe('{{title}}-BBCiPlayarrTurbo');
        });

        it('never cuts a hyphen inside a variable or a leading literal', () => {
            expect(applyGroupToTemplate('Spider-Man.{{title}}')).toBe('Spider-Man.{{title}}-BBCiPlayarrTurbo');
        });
    });

    describe('applyGroupToName', () => {
        it('swaps the legacy -BBC group and leaves our own alone', () => {
            expect(applyGroupToName('Show.S01E01.WEBDL.720p-BBC')).toBe('Show.S01E01.WEBDL.720p-BBCiPlayarrTurbo');
            expect(applyGroupToName('Show.S01E01-BBCiPlayarrTurbo')).toBe('Show.S01E01-BBCiPlayarrTurbo');
        });

        it('appends to a name with no group, without cutting a hyphenated title', () => {
            expect(applyGroupToName('Spider-Man')).toBe('Spider-Man-BBCiPlayarrTurbo');
        });
    });

    describe('templateGroupProblem', () => {
        it('refuses a variable straight after the final hyphen', () => {
            expect(templateGroupProblem('{{title}}-{{quality}}')).toMatch(/BBCiPlayarrTurbo/);
        });

        it('accepts literal or missing groups', () => {
            expect(templateGroupProblem('{{title}}.{{quality}}-BBC')).toBeUndefined();
            expect(templateGroupProblem('{{title}}.{{quality}}')).toBeUndefined();
        });
    });
});

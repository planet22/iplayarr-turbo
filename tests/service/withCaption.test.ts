import { withCaption } from '../../src/service/browseService';

jest.mock('../../src/service/loggingService', () => ({ __esModule: true, default: { log: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

describe('withCaption', () => {
    const svg =
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" fill="#cc0000"/><path fill="#ffffff" d="M1 1h4v4z"/></svg>';

    it('keeps the original icon and writes the label under it on the logo colours', () => {
        const out = withCaption(svg, 'North East & Cumbria');
        expect(out).toContain('<rect width="24" height="24" fill="#cc0000"/>');
        expect(out).toContain('North East &amp; Cumbria</text>');
        expect(out).toContain('fill="#ffffff">North East');
    });

    it('keeps the standard width and shrinks the font for long labels, and leaves an unreadable svg alone', () => {
        const fontSize = (label: string) => Number(/font-size="([\d.]+)"/.exec(withCaption(svg, label))?.[1]);
        expect(withCaption(svg, 'Northern Ireland')).toContain('viewBox="0 0 24 24"');
        expect(fontSize('Northern Ireland')).toBeLessThan(fontSize('East'));
        expect(fontSize('North East & Cumbria') * 'North East & Cumbria'.length * 0.62).toBeLessThanOrEqual(22);
        expect(withCaption('<svg></svg>', 'East')).toBe('<svg></svg>');
    });
});

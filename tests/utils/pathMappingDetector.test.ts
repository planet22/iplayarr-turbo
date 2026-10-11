import fs from 'fs';
import os from 'os';
import path from 'path';

import { detectPathMapping } from '../../src/utils/pathMappingDetector';

describe('detectPathMapping', () => {
    let root: string;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'iplayarr-pathmap-'));
        fs.mkdirSync(path.join(root, 'media', 'tv', 'Show'), { recursive: true });
        fs.writeFileSync(path.join(root, 'media', 'tv', 'Show', 'ep1.strm'), 'x');
        fs.writeFileSync(path.join(root, 'media', 'tv', 'Show', 'ep2.strm'), 'x');
    });

    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

    it('finds the prefix another container uses for the same files', () => {
        const mapping = detectPathMapping(['/data/media/tv/Show/ep1.strm', '/data/media/tv/Show/ep2.strm'], [root]);
        expect(mapping).toEqual({ from: '/data', to: root, matched: 2, tested: 2 });
    });

    it('handles a deeper stripped prefix', () => {
        const mapping = detectPathMapping(['/volume1/data/media/tv/Show/ep1.strm'], [root]);
        expect(mapping?.from).toBe('/volume1/data');
    });

    it('returns undefined when the files are not found anywhere', () => {
        expect(detectPathMapping(['/data/other/thing/missing.strm'], [root])).toBeUndefined();
    });
});

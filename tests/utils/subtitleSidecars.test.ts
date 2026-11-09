import fs from 'fs';
import os from 'os';
import path from 'path';

import { copySubtitleSidecars } from '../../src/utils/subtitleSidecarCopy';
import { subtitleMode, vttToSrt } from '../../src/utils/subtitleSidecars';

describe('subtitleMode', () => {
    it.each([
        ['off', { sidecar: false, embed: false }],
        ['sidecar', { sidecar: true, embed: false }],
        ['embed', { sidecar: false, embed: true }],
        ['both', { sidecar: true, embed: true }],
        ['BOTH', { sidecar: true, embed: true }],
        ['', { sidecar: true, embed: false }],
        [undefined, { sidecar: true, embed: false }],
        ['nonsense', { sidecar: true, embed: false }],
    ])('%s', (value, expected) => {
        expect(subtitleMode(value)).toEqual(expected);
    });
});

describe('vttToSrt (malformed input)', () => {
    it('skips a cue whose timing line cannot be read', () => {
        expect(vttToSrt(['WEBVTT', '', 'soon --> later', 'Lost'].join('\n'))).toBe('');
    });

    it('pads hour-less and short millisecond times', () => {
        expect(vttToSrt(['WEBVTT', '', '01:02.5 --> 01:03.50', 'Hi'].join('\n'))).toBe(['1', '00:01:02,500 --> 00:01:03,500', 'Hi', ''].join('\n'));
    });
});

describe('vttToSrt', () => {
    it('converts cues, drops header, settings and styling tags', () => {
        const vtt = [
            'WEBVTT',
            '',
            '00:00:01.200 --> 00:00:03.500 line:85%',
            '<c.yellow>Hello</c>',
            '<i>there</i>',
            '',
            '1',
            '01:02.000 --> 01:04.250',
            'Short form',
            '',
        ].join('\n');
        expect(vttToSrt(vtt)).toBe(
            '1\n00:00:01,200 --> 00:00:03,500\nHello\n<i>there</i>\n\n2\n00:01:02,000 --> 00:01:04,250\nShort form\n'
        );
    });

    it('returns an empty string when there are no cues', () => {
        expect(vttToSrt('WEBVTT\n\n')).toBe('');
    });
});

describe('copySubtitleSidecars', () => {
    let src: string;
    let dest: string;

    beforeEach(() => {
        src = fs.mkdtempSync(path.join(os.tmpdir(), 'subs-src-'));
        dest = fs.mkdtempSync(path.join(os.tmpdir(), 'subs-dest-'));
    });

    afterEach(() => {
        fs.rmSync(src, { recursive: true, force: true });
        fs.rmSync(dest, { recursive: true, force: true });
    });

    it('names subtitle files after the moved video, keeping a language tag', async () => {
        fs.writeFileSync(path.join(src, 'Show.mp4'), 'v');
        fs.writeFileSync(path.join(src, 'Show.srt'), 'a');
        fs.writeFileSync(path.join(src, 'Show.en.srt'), 'b');
        fs.writeFileSync(path.join(src, 'other.vtt'), 'c');
        fs.writeFileSync(path.join(src, 'notes.txt'), 'd');

        const written = await copySubtitleSidecars(src, 'Show.mp4', path.join(dest, 'Final Name.mp4'));

        expect(written.map((p) => path.basename(p)).sort()).toEqual(['Final Name.en.srt', 'Final Name.en.vtt', 'Final Name.srt']);
        expect(fs.readFileSync(path.join(dest, 'Final Name.srt'), 'utf8')).toBe('a');
        expect(fs.existsSync(path.join(dest, 'Final Name.txt'))).toBe(false);
    });

    it('strips yt-dlp font wrappers from a copied .srt and leaves other files alone', async () => {
        const nlc = '\n';
        fs.writeFileSync(path.join(src, 'Show.mp4'), 'v');
        fs.writeFileSync(
            path.join(src, 'Show.en.srt'),
            ['1', '00:00:01,000 --> 00:00:02,000', '<font face="ReithSans" size="150%"><font color="#FFFFFF">Hello</font></font>', '<i>there</i>', ''].join(nlc)
        );
        fs.writeFileSync(path.join(src, 'Show.en.vtt'), '<font color="red">kept</font>');

        await copySubtitleSidecars(src, 'Show.mp4', path.join(dest, 'Final.mp4'));

        expect(fs.readFileSync(path.join(dest, 'Final.en.srt'), 'utf8')).toBe(['1', '00:00:01,000 --> 00:00:02,000', 'Hello', '<i>there</i>', ''].join(nlc));
        expect(fs.readFileSync(path.join(dest, 'Final.en.vtt'), 'utf8')).toBe('<font color="red">kept</font>');
    });

    it('does nothing when there are no subtitles', async () => {
        fs.writeFileSync(path.join(src, 'Show.mp4'), 'v');
        expect(await copySubtitleSidecars(src, 'Show.mp4', path.join(dest, 'x.mp4'))).toEqual([]);
    });
});

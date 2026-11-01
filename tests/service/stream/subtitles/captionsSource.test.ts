import { fetchText } from '../../../../src/service/stream/bbcHttp';
import { extractCaptionsHref, loadSubtitleTrack } from '../../../../src/service/stream/subtitles/captionsSource';

jest.mock('../../../../src/service/stream/bbcHttp', () => ({
    ...jest.requireActual('../../../../src/service/stream/bbcHttp'),
    fetchText: jest.fn(),
}));

const xml = (media: string) => `<?xml version="1.0"?><mediaSelection>${media}</mediaSelection>`;

describe('extractCaptionsHref', () => {
    it('returns the https captions connection, ignoring video media', () => {
        const out = extractCaptionsHref(
            xml(`<media kind="video"><connection href="https://v/x.m3u8" protocol="https" transferFormat="hls"/></media>
                 <media kind="captions" type="application/ttml+xml"><connection href="http://c/a.xml" protocol="http" transferFormat="plain"/><connection href="https://c/b.xml" protocol="https" transferFormat="plain"/></media>`)
        );
        expect(out).toBe('https://c/b.xml');
    });

    it('skips live-style dash captions and returns undefined when none usable', () => {
        expect(
            extractCaptionsHref(
                xml(
                    '<media kind="captions"><connection href="https://c/$Number$.m4s" protocol="https" transferFormat="dash"/></media>'
                )
            )
        ).toBeUndefined();
        expect(
            extractCaptionsHref(
                xml('<media kind="video"><connection href="https://v" protocol="https" transferFormat="hls"/></media>')
            )
        ).toBeUndefined();
        expect(extractCaptionsHref('<error id="notukerror"/>')).toBeUndefined();
    });
});

describe('loadSubtitleTrack', () => {
    afterEach(() => jest.useRealTimers());

    it('gives up and reports it when the lookup takes too long', async () => {
        jest.useFakeTimers();
        (fetchText as jest.Mock).mockReturnValue(new Promise(() => undefined));
        const onError = jest.fn();
        const pending = loadSubtitleTrack('vpid-slow', onError);
        await jest.advanceTimersByTimeAsync(5_001);
        expect(await pending).toBeUndefined();
        expect(onError).toHaveBeenCalledWith(expect.stringContaining('timed out'));
    });
});

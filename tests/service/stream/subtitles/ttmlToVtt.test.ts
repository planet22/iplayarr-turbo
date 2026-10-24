import { parseTime, ttmlToVtt } from '../../../../src/service/stream/subtitles/ttmlToVtt';

const ttml = `<?xml version="1.0" encoding="utf-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" xmlns:tts="http://www.w3.org/ns/ttml#styling" xmlns:ebuttm="urn:ebu:tt:metadata" xml:lang="en">
  <head>
    <styling>
      <style xml:id="white" tts:color="#FFFFFF" tts:backgroundColor="#000000"/>
      <style xml:id="yellow" tts:color="#FFFF00" tts:backgroundColor="#000000"/>
      <style xml:id="evil" tts:color="red;}body{x:y" tts:backgroundColor="#000000"/>
    </styling>
    <layout>
      <region xml:id="bottom" tts:origin="10% 70%" tts:extent="80% 20%" tts:displayAlign="after"/>
      <region xml:id="top" tts:origin="10% 5%" tts:extent="80% 20%" tts:displayAlign="before"/>
    </layout>
  </head>
  <body>
    <div>
      <p xml:id="s1" begin="00:00:01.200" end="00:00:03.500" region="bottom"><span style="white">Hello &amp; welcome</span><br/><span style="yellow">to <b>the</b> show</span></p>
      <p xml:id="s2" begin="00:00:04.000" end="00:00:05.000" region="top"><span style="evil">Top &lt;line&gt;</span></p>
      <p xml:id="s3" begin="00:00:06.000" end="00:00:06.000"><span>zero length</span></p>
      <p xml:id="s4" begin="00:00:07.000" end="00:00:09.000">   </p>
    </div>
  </body>
</tt>`;

describe('parseTime', () => {
    it('parses clock, frame and offset times', () => {
        expect(parseTime('00:01:02.500')).toBeCloseTo(62.5);
        expect(parseTime('01:00:00:12')).toBe(3600);
        expect(parseTime('1.5s')).toBe(1.5);
        expect(parseTime('1500ms')).toBe(1.5);
        expect(parseTime('garbage')).toBeUndefined();
        expect(parseTime(undefined)).toBeUndefined();
    });
});

describe('ttmlToVtt', () => {
    it('converts cues, line breaks, regions and styles', async () => {
        const { vtt, durationSeconds } = await ttmlToVtt(ttml);
        expect(vtt.startsWith('WEBVTT\nX-TIMESTAMP-MAP=MPEGTS:900000,LOCAL:00:00:10.000\n')).toBe(true);
        expect(vtt).toContain('00:00:11.200 --> 00:00:13.500 line:90%,end');
        expect(vtt).toContain('<c.c-white>Hello &amp; welcome</c>\n<c.c-yellow>to the show</c>');
        expect(vtt).toContain('00:00:14.000 --> 00:00:15.000 line:5%,start');
        expect(vtt).toContain('::cue(.c-white) { color: #FFFFFF; background-color: #000000; }');
        expect(durationSeconds).toBe(5);
    });

    it('drops empty and zero-length cues and unsafe colours', async () => {
        const { vtt } = await ttmlToVtt(ttml);
        expect(vtt).not.toContain('zero length');
        expect(vtt).not.toContain('00:00:07.000');
        expect(vtt).not.toContain('body{');
        expect(vtt).toContain('Top &lt;line&gt;');
    });

    it('omits the timestamp map when asked', async () => {
        const { vtt } = await ttmlToVtt(ttml, null);
        expect(vtt).not.toContain('X-TIMESTAMP-MAP');
    });

    it('reports no duration for a document without cues', async () => {
        const { durationSeconds } = await ttmlToVtt('<tt xmlns="http://www.w3.org/ns/ttml"><body><div/></body></tt>');
        expect(durationSeconds).toBe(0);
    });

    it('rejects a document that is not XML', async () => {
        await expect(ttmlToVtt('<html><body>nope')).rejects.toBeDefined();
    });
});

import { parseIplayerState } from '../../src/utils/iplayerState';

describe('parseIplayerState', () => {
    it('extracts the embedded state', () => {
        const html = `<html><script>window.__IPLAYER_REDUX_STATE__ = ${JSON.stringify({ bundles: [{ id: 'a' }] })};</script></html>`;
        expect(parseIplayerState(html)).toEqual({ bundles: [{ id: 'a' }] });
    });

    it('is undefined when there is no state or it is not valid JSON', () => {
        expect(parseIplayerState('<html>nothing</html>')).toBeUndefined();
        expect(parseIplayerState('<script>__IPLAYER_REDUX_STATE__ = {broken};</script>')).toBeUndefined();
    });
});

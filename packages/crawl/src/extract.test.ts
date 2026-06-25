import { describe, it, expect } from 'vitest';
import { parsePlaceExtraction } from './extract.js';
import { htmlToText, extractTitle } from './html.js';

describe('parsePlaceExtraction', () => {
  it('parses fenced JSON into PlaceInfo, omitting empty optionals', () => {
    const text = '```json\n{"summary":"良いカフェ","category":"カフェ","address":""}\n```';
    expect(parsePlaceExtraction(text)).toEqual({ summary: '良いカフェ', category: 'カフェ' });
  });

  it('keeps address when present', () => {
    const text = '{"summary":"展望台","category":"","address":"東京都港区芝公園4-2-8"}';
    expect(parsePlaceExtraction(text)).toEqual({
      summary: '展望台',
      address: '東京都港区芝公園4-2-8',
    });
  });

  it('throws on non-JSON output', () => {
    expect(() => parsePlaceExtraction('すみません、抽出できませんでした')).toThrow();
  });
});

describe('html', () => {
  it('strips tags and decodes entities', () => {
    const html = '<title>X &amp; Y</title><body><script>bad()</script><p>Hello&nbsp;World</p></body>';
    expect(extractTitle(html)).toBe('X & Y');
    const t = htmlToText(html);
    expect(t).toContain('Hello World');
    expect(t).not.toContain('bad()');
  });
});

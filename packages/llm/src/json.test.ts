import { describe, it, expect } from 'vitest';
import { extractJsonBlock } from './json.js';

describe('extractJsonBlock', () => {
  it('extracts a fenced json block', () => {
    const text = 'ここに説明\n```json\n{"a":1}\n```\n後置き';
    expect(JSON.parse(extractJsonBlock(text))).toEqual({ a: 1 });
  });

  it('extracts a bare object between braces', () => {
    const text = 'prefix {"b":"x","c":[1,2]} suffix';
    expect(JSON.parse(extractJsonBlock(text))).toEqual({ b: 'x', c: [1, 2] });
  });

  it('throws when no object is present', () => {
    expect(() => extractJsonBlock('no json here')).toThrow();
  });
});

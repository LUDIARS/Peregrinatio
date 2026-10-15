import { describe, expect, it } from 'vitest';
import { stripBuildParam } from './build-param.js';

describe('ビルド更新リロードの版数パラメータ', () => {
  it('付いていれば取り除き、他のクエリ・パス・ハッシュは残す', () => {
    expect(stripBuildParam('https://pe.example/trips/1?tab=map&_pe_build=abc123#day2'))
      .toBe('https://pe.example/trips/1?tab=map#day2');
  });

  it('版数パラメータだけなら ? ごと消える', () => {
    expect(stripBuildParam('https://pe.example/?_pe_build=abc123')).toBe('https://pe.example/');
  });

  it('付いていなければ書き換えない', () => {
    expect(stripBuildParam('https://pe.example/trips?tab=map')).toBeNull();
  });
});

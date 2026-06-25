import { describe, it, expect } from 'vitest';
import { parseRobots, isAllowed, pathOf } from './robots.js';

describe('robots', () => {
  it('pathOf returns path + query', () => {
    expect(pathOf('https://x.com/a/b?c=1')).toBe('/a/b?c=1');
    expect(pathOf('not-a-url')).toBe('/');
  });

  it('honors Disallow for * group', () => {
    const r = parseRobots('User-agent: *\nDisallow: /private', 'PeregrinatioBot/0.1');
    expect(isAllowed(r, '/private/x')).toBe(false);
    expect(isAllowed(r, '/public')).toBe(true);
  });

  it('Allow overrides a shorter Disallow (longest match wins)', () => {
    const r = parseRobots('User-agent: *\nDisallow: /a\nAllow: /a/ok', 'Bot');
    expect(isAllowed(r, '/a/ok/x')).toBe(true);
    expect(isAllowed(r, '/a/no')).toBe(false);
  });

  it('matches UA-specific group over *', () => {
    const txt = 'User-agent: *\nDisallow: /\n\nUser-agent: peregrinatiobot\nDisallow:';
    const r = parseRobots(txt, 'PeregrinatioBot/0.1');
    expect(isAllowed(r, '/anything')).toBe(true);
  });

  it('parses crawl-delay', () => {
    const r = parseRobots('User-agent: *\nCrawl-delay: 5', 'Bot');
    expect(r.crawlDelay).toBe(5);
  });

  it('empty robots allows everything', () => {
    const r = parseRobots('', 'Bot');
    expect(isAllowed(r, '/whatever')).toBe(true);
  });
});

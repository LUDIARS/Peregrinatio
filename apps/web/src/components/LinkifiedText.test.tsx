import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LinkifiedText } from './LinkifiedText.js';

describe('LinkifiedText', () => {
  it('escapes user text and links only the URL without trailing punctuation', () => {
    const html = renderToStaticMarkup(
      <LinkifiedText text={'<script>alert(1)</script> https://example.com/book).'} />,
    );

    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('href="https://example.com/book"');
    expect(html).toContain('>https://example.com/book</a>).');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer"');
  });

  it('does not link non-HTTP schemes', () => {
    const html = renderToStaticMarkup(<LinkifiedText text="javascript:alert(1)" />);

    expect(html).not.toContain('<a ');
  });

  it('keeps a balanced closing parenthesis inside the URL', () => {
    const html = renderToStaticMarkup(
      <LinkifiedText text="https://example.com/wiki/Function_(mathematics)." />,
    );

    expect(html).toContain('href="https://example.com/wiki/Function_(mathematics)"');
  });
});

import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App.js';
import { currentBuildVersion } from './lib/build-version.js';

// App のヘッダだけを静的に検証する。NavMenu はブラウザの localStorage を初期化時に
// 参照するため、Node で動くこのテストからは切り離す。
vi.mock('./components/NavMenu.js', () => ({ NavMenu: () => null }));

describe('アプリのヘッダ', () => {
  it('ビルド時に解決された版数を持つ', () => {
    // 版数が空だと画面には "v" だけが残り、更新の有無を判別できなくなる。
    expect(currentBuildVersion).toMatch(/\S/);
  });

  it('ブランドロゴの横に稼働中の版数を表示する', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );

    expect(html).toContain('class="brand-version"');
    expect(html).toContain(`v${currentBuildVersion}`);
  });
});

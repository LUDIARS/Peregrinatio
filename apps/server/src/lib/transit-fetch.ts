// ヘッドレスブラウザ (Puppeteer) で Google マップの公共交通(乗換)経路ページを開いて描画し、
// 経路結果のテキストを抽出する。スマホでコピペできないユーザ向けに、サーバ側で自動取得する
// (暫定。将来 ODPT に置換)。抽出テキストは transit-parse.ts (LLM) で構造化する。
// Routes/Directions API は日本の transit を返さないための回避策。
// 失敗 (同意画面/描画されない/ヘッドレス検知) は silent fallback せず明示エラーにする。

import puppeteer from 'puppeteer';

// 実ブラウザらしい UA (ヘッドレス検知の軽減)。
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// 経路結果が描画されたかの判定 (所要分 / 運賃 / 時間表記)。
const ROUTE_SIGNAL = /(\d+\s*分|¥\s*?\d|\d+\s*時間|発\s*\d|着\s*\d)/;

function buildTransitUrl(from: { lat: number; lng: number }, to: { lat: number; lng: number }): string {
  return (
    'https://www.google.com/maps/dir/?api=1' +
    `&origin=${from.lat},${from.lng}` +
    `&destination=${to.lat},${to.lng}` +
    '&travelmode=transit'
  );
}

/** Cookie 同意 / 「続行」画面が出ていれば best-effort で通過する。 */
async function passConsent(page: import('puppeteer').Page): Promise<void> {
  if (!/consent\.google\.com|\/sorry\//.test(page.url())) return;
  // 同意ボタン (日本語/英語) を探して押す。
  const clicked = await page.evaluate(() => {
    const labels = ['すべて同意', '同意する', '同意', 'Accept all', 'I agree', 'Accept'];
    const btns = Array.from(document.querySelectorAll('button, [role="button"], input[type="submit"]')) as HTMLElement[];
    for (const b of btns) {
      const t = (b.innerText || (b as HTMLInputElement).value || '').trim();
      if (labels.some((l) => t.includes(l))) { b.click(); return true; }
    }
    return false;
  }).catch(() => false);
  if (clicked) {
    await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => undefined);
  }
}

/**
 * Google マップの乗換経路を開いて結果テキストを取得する。
 * @throws 経路が読み取れなかったとき
 */
export async function fetchGmapsTransitText(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): Promise<string> {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--lang=ja-JP'],
  } as unknown as Parameters<typeof puppeteer.launch>[0]);
  try {
    const page = await browser.newPage();
    await page.setUserAgent(UA);
    await page.setViewport({ width: 1280, height: 1200 });
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'ja-JP,ja;q=0.9' });
    // Cookie 同意の事前バイパス (長年有効な CONSENT=YES+)。
    await page.setCookie({ name: 'CONSENT', value: 'YES+', domain: '.google.com', path: '/' }).catch(() => undefined);

    await page.goto(buildTransitUrl(from, to), { waitUntil: 'domcontentloaded', timeout: 30000 });
    await passConsent(page);

    // 経路パネルが描画されるまでポーリング (SPA なので networkidle に頼らない)。
    const deadline = Date.now() + 25000;
    let text = '';
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1500));
      text = await page
        .evaluate(() => {
          const main = document.querySelector('[role="main"]') as HTMLElement | null;
          return (main?.innerText || document.body?.innerText || '').trim();
        })
        .catch(() => '');
      if (ROUTE_SIGNAL.test(text)) break;
    }

    if (!ROUTE_SIGNAL.test(text)) {
      throw new Error('Google マップの経路を読み取れませんでした（公共交通の結果が出ない/同意画面/混雑の可能性）。少し待って再試行するか、手動貼り付けをお使いください。');
    }
    // パネル全文は長いので、経路に関係する先頭部分に絞る (LLM 入力を軽くする)。
    return text.slice(0, 4000);
  } finally {
    await browser.close().catch(() => undefined);
  }
}

// 画像ユーティリティ。Kindle 連番画像の寸法取得と、和書の見開き/扉絵を
// 右→左 (rtl) に横連結する処理を sharp で実装する。

import sharp from 'sharp';
import type { OverlayOptions } from 'sharp';

/** 画像ファイルのピクセル寸法を返す。寸法が読めなければ即エラー。 */
export async function imageSize(path: string): Promise<{ width: number; height: number }> {
  const meta = await sharp(path).metadata();
  if (!meta.width || !meta.height) {
    throw new Error(`imageSize: failed to read dimensions of ${path}`);
  }
  return { width: meta.width, height: meta.height };
}

/**
 * 複数画像を共通の高さ (最大高さ) に揃えて横に連結し outPath へ保存する。
 * outPath の拡張子が .png なら PNG、それ以外は JPEG で出力する。
 *
 * order='rtl' (既定): inputPaths[0] (連番 1 枚目) が一番右になるよう配置する。
 *   和書の見開き/扉絵は右→左に読むため。
 * order='ltr': inputPaths[0] が一番左。
 */
export async function composeHorizontally(
  inputPaths: string[],
  outPath: string,
  order: 'rtl' | 'ltr' = 'rtl',
): Promise<{ width: number; height: number }> {
  if (inputPaths.length === 0) {
    throw new Error('composeHorizontally: inputPaths is empty');
  }

  // 各画像の元寸法 → 共通高さ (最大高さ) を決める。
  const sizes = await Promise.all(inputPaths.map((p) => imageSize(p)));
  const targetHeight = Math.max(...sizes.map((s) => s.height));

  // 共通高さへリサイズしたバッファを作る (実際の width は sharp の結果から取る)。
  const resized = await Promise.all(
    inputPaths.map(async (p) => {
      const { data, info } = await sharp(p)
        .resize({ height: targetHeight })
        .toBuffer({ resolveWithObject: true });
      return { buffer: data, width: info.width, height: info.height };
    }),
  );

  // 左→右のピクセル並び。rtl のとき inputPaths[0] を一番右にするため反転する。
  const visual = order === 'rtl' ? [...resized].reverse() : resized;

  const totalWidth = visual.reduce((sum, r) => sum + r.width, 0);

  const composites: OverlayOptions[] = [];
  let x = 0;
  for (const r of visual) {
    composites.push({ input: r.buffer, left: x, top: 0 });
    x += r.width;
  }

  const isPng = /\.png$/i.test(outPath);
  const base = sharp({
    create: {
      width: totalWidth,
      height: targetHeight,
      channels: isPng ? 4 : 3,
      background: isPng ? { r: 255, g: 255, b: 255, alpha: 1 } : { r: 255, g: 255, b: 255 },
    },
  }).composite(composites);

  await (isPng ? base.png() : base.jpeg({ quality: 90 })).toFile(outPath);

  return { width: totalWidth, height: targetHeight };
}

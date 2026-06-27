// 取り込みジョブ (画像解析/クロール) を 1 件ずつ順次処理するバックグラウンドキュー。
//   config.jobs.intervalMs ごとに pending を 1 件取り出し、画像なら vision 解析、URL なら
//   クロールを実行する。完了後に「成立 (座標が付いたか)」を判定し、成立=done、未成立=needs_info
//   (不足情報を記録して一覧には出さない)、例外=failed とする。
// 起動は index.ts の startJobQueue() (config.jobs.enabled 時) から。base-summary と同じ方式。

import { sql } from '../db/index.js';
import { config } from '../config.js';
import { nowIso } from '../lib/ids.js';
import { runImageAnalysis, runPlaceCrawl } from '../routes/crawl.js';
import type { Place, PlaceImage, PlaceJob } from '../types.js';

let started = false;
let running = false; // 同一プロセス内では 1 件ずつ (順次処理)

/** place が「場所として成立」しているか = 地図に置ける座標を持つか。 */
function isEstablished(place: Place | undefined): boolean {
  return !!place && place.lat != null && place.lng != null;
}

/** 成立しない時、ユーザに伝える不足情報の文言を作る。 */
function missingInfoFor(place: Place | undefined): string {
  if (!place) return '場所が見つかりません';
  const missing: string[] = [];
  if (place.lat == null || place.lng == null) missing.push('地図上の位置（住所を特定できませんでした）');
  if (!place.name || place.name.trim() === '' || place.name === '画像から取り込み中…') missing.push('場所の名前');
  return missing.length ? missing.join(' / ') : '追加情報';
}

/** ジョブ種別ごとの重い処理 (crawl.ts のコア関数へ委譲)。 */
async function processJob(job: PlaceJob): Promise<void> {
  if (job.kind === 'image') {
    const [comp] = (await sql`
      SELECT * FROM place_images WHERE place_id=${job.place_id} AND kind='composite'
      ORDER BY created_at DESC LIMIT 1`) as PlaceImage[];
    if (!comp) throw new Error('解析対象の合成画像が見つかりません');
    await runImageAnalysis(comp.id);
  } else if (job.kind === 'crawl') {
    if (!job.source_url) throw new Error('クロール対象 URL がありません');
    await runPlaceCrawl(job.place_id, job.source_url);
  } else {
    throw new Error(`未知のジョブ種別: ${String(job.kind)}`);
  }
}

/** 走査 1 回分。pending を 1 件だけ処理する。 */
async function scanOnce(): Promise<void> {
  if (running) return;
  const [job] = (await sql`
    SELECT * FROM place_jobs WHERE status='pending' ORDER BY created_at LIMIT 1`) as PlaceJob[];
  if (!job) return;

  running = true;
  try {
    await sql`UPDATE place_jobs SET status='processing', error=NULL, updated_at=${nowIso()} WHERE id=${job.id}`;
    await processJob(job);

    const [place] = (await sql`SELECT * FROM places WHERE id=${job.place_id}`) as Place[];
    if (isEstablished(place)) {
      await sql`UPDATE place_jobs SET status='done', missing_info=NULL, error=NULL, updated_at=${nowIso()} WHERE id=${job.id}`;
      console.log(`[jobs] 取り込み完了 (job=${job.id}, place=${job.place_id})`);
    } else {
      const missing = missingInfoFor(place);
      await sql`UPDATE place_jobs SET status='needs_info', missing_info=${missing}, updated_at=${nowIso()} WHERE id=${job.id}`;
      console.log(`[jobs] 情報不足で保留 (job=${job.id}): ${missing}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await sql`UPDATE place_jobs SET status='failed', error=${msg}, updated_at=${nowIso()} WHERE id=${job.id}`;
    console.error(`[jobs] 取り込み失敗 (job=${job.id}):`, msg);
  } finally {
    running = false;
  }
}

/** 取り込みキューの定期走査を開始する (1 プロセス 1 回のみ)。 */
export function startJobQueue(): void {
  if (started) return;
  started = true;

  const timer = setInterval(() => {
    void scanOnce().catch((err) => {
      console.error('[jobs] 走査でエラー:', err);
    });
  }, config.jobs.intervalMs);
  timer.unref();

  console.log(`[jobs] 取り込みキューを開始 (間隔 ${config.jobs.intervalMs}ms)`);
}

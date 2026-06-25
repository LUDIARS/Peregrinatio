import { Hono } from 'hono';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';
import { composeHorizontally, imageSize } from '@peregrinatio/image';
import { sql } from '../db/index.js';
import { config, PROJECT_ROOT } from '../config.js';
import { newId, nowIso } from '../lib/ids.js';
import type { PlaceImage } from '../types.js';

const app = new Hono();

/** 保存パス (DB の path = URL パス) から実ファイル絶対パスを得る。 */
function absFromPath(p: string): string {
  return resolve(PROJECT_ROOT, 'apps/server', p.replace(/^\//, ''));
}

/** POST /api/places/:id/images — 連番画像を複数アップロード (kind='source')。 */
app.post('/api/places/:id/images', async (c) => {
  const placeId = c.req.param('id');
  const [place] = (await sql`SELECT id FROM places WHERE id=${placeId}`) as { id: string }[];
  if (!place) return c.json({ error: 'place not found' }, 404);

  const body = await c.req.parseBody({ all: true });
  const raw = body['files'];
  const files = (Array.isArray(raw) ? raw : [raw]).filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return c.json({ error: 'no files (multipart field name must be "files")' }, 400);
  }

  const idxRows = (await sql`
    SELECT COALESCE(MAX(order_index), -1) AS maxIdx
    FROM place_images WHERE place_id=${placeId} AND kind='source'`) as { maxIdx: number }[];
  let next = (idxRows[0]?.maxIdx ?? -1) + 1;

  const dir = join(config.uploadsDir, 'places', placeId);
  await mkdir(dir, { recursive: true });

  const created: PlaceImage[] = [];
  for (const file of files) {
    const ext = extname(file.name) || '.jpg';
    const filename = `${newId()}${ext}`;
    const abs = join(dir, filename);
    await writeFile(abs, Buffer.from(await file.arrayBuffer()));

    const { width, height } = await imageSize(abs);
    const urlPath = `/uploads/places/${placeId}/${filename}`;
    const id = newId();
    const now = nowIso();
    await sql`INSERT INTO place_images (id, place_id, kind, path, order_index, width, height, created_at)
      VALUES (${id}, ${placeId}, 'source', ${urlPath}, ${next}, ${width}, ${height}, ${now})`;
    const [row] = (await sql`SELECT * FROM place_images WHERE id=${id}`) as PlaceImage[];
    if (row) created.push(row);
    next++;
  }

  return c.json(created);
});

/** GET /api/places/:id/images — place の画像を order_index 昇順で返す。 */
app.get('/api/places/:id/images', async (c) => {
  const rows = (await sql`
    SELECT * FROM place_images WHERE place_id=${c.req.param('id')}
    ORDER BY order_index`) as PlaceImage[];
  return c.json(rows);
});

/** POST /api/places/:id/images/compose — source を横連結 (既定 rtl) して composite を 1 枚作る。 */
app.post('/api/places/:id/images/compose', async (c) => {
  const placeId = c.req.param('id');
  const body = (await c.req.json().catch(() => ({}))) as { order?: 'rtl' | 'ltr' };
  const order = body.order === 'ltr' ? 'ltr' : 'rtl';

  const sources = (await sql`
    SELECT * FROM place_images WHERE place_id=${placeId} AND kind='source'
    ORDER BY order_index`) as PlaceImage[];
  if (sources.length === 0) return c.json({ error: 'no source images to compose' }, 400);

  const inputAbs = sources.map((s) => absFromPath(s.path));

  const dir = join(config.uploadsDir, 'places', placeId);
  await mkdir(dir, { recursive: true });
  const filename = `${newId()}.jpg`;
  const outAbs = join(dir, filename);
  const { width, height } = await composeHorizontally(inputAbs, outAbs, order);

  // 既存 composite の実ファイル + DB 行を削除して置換する。
  const existing = (await sql`
    SELECT * FROM place_images WHERE place_id=${placeId} AND kind='composite'`) as PlaceImage[];
  for (const e of existing) {
    await rm(absFromPath(e.path), { force: true }).catch(() => {});
  }
  await sql`DELETE FROM place_images WHERE place_id=${placeId} AND kind='composite'`;

  const urlPath = `/uploads/places/${placeId}/${filename}`;
  const id = newId();
  const now = nowIso();
  await sql`INSERT INTO place_images (id, place_id, kind, path, order_index, width, height, created_at)
    VALUES (${id}, ${placeId}, 'composite', ${urlPath}, 0, ${width}, ${height}, ${now})`;
  const [row] = (await sql`SELECT * FROM place_images WHERE id=${id}`) as PlaceImage[];
  return c.json(row);
});

export default app;

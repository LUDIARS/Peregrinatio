import { BUILD_PARAM, stripBuildParam } from './build-param.js';

declare const __PE_BUILD_VERSION__: string;
declare const __PE_BUILD_BUILT_AT__: string;

interface BuildMeta {
  version?: string;
  built_at?: string;
}

const CURRENT_BUILD_VERSION = __PE_BUILD_VERSION__;
const CURRENT_BUILD_BUILT_AT = __PE_BUILD_BUILT_AT__;

/** Version resolved from Excubitor at the time this Web UI was built. */
export const currentBuildVersion = CURRENT_BUILD_VERSION;

export function installBuildCacheBuster(): void {
  if (typeof window === 'undefined') return;
  clearBuildParamFromUrl();
  // module script は通常 load 前に走るが、遅延 import 等で load 後に来ても取りこぼさない。
  if (document.readyState === 'complete') {
    startBuildCheck();
    return;
  }
  window.addEventListener('load', startBuildCheck, { once: true });
}

/**
 * ビルド更新のリロードで付けた `?_pe_build=` を、表示中の URL から消す。
 * 残すと以後の共有リンクやブックマークに版数が付いたままになる。履歴は増やさない。
 */
function clearBuildParamFromUrl(): void {
  const cleaned = stripBuildParam(window.location.href);
  if (cleaned === null) return;
  try {
    window.history.replaceState(window.history.state, '', cleaned);
  } catch {
    // replaceState が使えない環境では URL が残るだけで、アプリの動作には影響しない。
  }
}

/** 更新確認は付加機能なので、失敗しても unhandledRejection にせずアプリを続行させる。 */
function startBuildCheck(): void {
  void checkForNewBuild().catch(() => undefined);
}

async function checkForNewBuild(): Promise<void> {
  const latest = await fetchLatestBuildMeta();
  if (!latest.version || latest.version === CURRENT_BUILD_VERSION) {
    rememberCurrentBuild();
    return;
  }

  // 1 ビルドにつき 1 回だけリロードする。印を残せない環境ではリロードしない
  // (古い Service Worker が旧 JS を返し続けると、印無しでは無限リロードになるため)。
  const reloadKey = `pe:build-reload:${latest.version}`;
  if (readReloadMark(reloadKey) || !writeReloadMark(reloadKey)) return;

  await purgeAppCaches();
  reloadWithBuildVersion(latest.version);
}

/** sessionStorage はプライベートモード/Cookie ブロック時に参照自体が throw する。 */
function readReloadMark(key: string): boolean {
  try {
    return window.sessionStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeReloadMark(key: string): boolean {
  try {
    window.sessionStorage.setItem(key, '1');
    return true;
  } catch {
    return false;
  }
}

async function fetchLatestBuildMeta(): Promise<BuildMeta> {
  try {
    const res = await fetch(`/build-meta.json?t=${Date.now()}`, {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' },
    });
    if (!res.ok) return {};
    return (await res.json()) as BuildMeta;
  } catch {
    return {};
  }
}

/** キャッシュ掃除は best-effort。ここで失敗してもリロード自体は必ず実行する。 */
async function purgeAppCaches(): Promise<void> {
  const tasks: Array<Promise<unknown>> = [];

  if ('serviceWorker' in navigator) {
    tasks.push(
      navigator.serviceWorker.getRegistrations().then((registrations) =>
        Promise.all(registrations.map((registration) => registration.update().catch(() => undefined))),
      ).catch(() => undefined),
    );
  }

  if ('caches' in window) {
    tasks.push(
      window.caches.keys().then((names) =>
        Promise.all(
          names
            .filter((name) => name.startsWith('pe-') || name.startsWith('workbox-precache'))
            .map((name) => window.caches.delete(name).catch(() => undefined)),
        ),
      ).catch(() => undefined),
    );
  }

  await Promise.all(tasks);
}

function reloadWithBuildVersion(version: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set(BUILD_PARAM, version);
  window.location.replace(url.toString());
}

function rememberCurrentBuild(): void {
  try {
    window.localStorage.setItem('pe:build-version', CURRENT_BUILD_VERSION);
    window.localStorage.setItem('pe:build-built-at', CURRENT_BUILD_BUILT_AT);
  } catch {
    // Storage can be unavailable in private mode; cache busting still works without it.
  }
}

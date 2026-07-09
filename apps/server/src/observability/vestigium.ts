// Vestigium (横断ログ収集) のプロセス単一インスタンス管理。
// install() で writer + console hook + retention sweeper を一括起動し、
// リクエスト計測ミドルウェア (request-log.ts) と共有する writer を expose する。
// 起動 (index.ts) / 統合テストのどちらからも安全に呼べるよう、未初期化時は
// getLogWriter() が null を返す (= ログはスキップ、本体は落とさない)。

import { install, type Vestigium, type Writer } from '@ludiars/vestigium';
import { config } from '../config.js';

let instance: Vestigium | null = null;

/**
 * 横断ログを初期化する。二重呼び出しは無視 (既存インスタンスを保つ)。
 * config.logging.enabled=false のときは何もしない。
 */
export function initVestigium(): Vestigium | null {
  if (instance) return instance;
  if (!config.logging.enabled) return null;
  instance = install({
    serviceCode: config.logging.serviceCode,
    logsDir: config.logging.logsDir,
    retentionDays: config.logging.retentionDays,
    captureConsole: config.logging.captureConsole,
  });
  return instance;
}

/** リクエスト計測などの構造化ログ用 writer。未初期化なら null。 */
export function getLogWriter(): Writer | null {
  return instance?.writer ?? null;
}

/** 終了時に console hook を外して writer を flush/close する。 */
export async function shutdownVestigium(): Promise<void> {
  if (!instance) return;
  const v = instance;
  instance = null;
  await v.shutdown();
}

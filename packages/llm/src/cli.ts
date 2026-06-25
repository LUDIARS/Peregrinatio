// claude Code CLI を print mode (-p) で呼ぶ低レベル層。
//
// LUDIARS 規約により Anthropic API は使わず、既ログインの claude CLI に肩代わりさせる
// ([[feedback_ludiars_no_api_use_claude_cli]])。プロンプトは stdin 経由で渡す
// (Windows の引数長制限 ENAMETOOLONG 回避)。
//
// 注意 (Windows): claude CLI は git-bash を要求する場合があり、その際は server プロセスの
// env に CLAUDE_CODE_GIT_BASH_PATH を設定しておくこと (spec/setup/llm-vision.md)。
// CLI 未ログイン / 未インストールは silent fallback せず、非 0 終了の stderr を載せて例外にする
// ([[feedback_no_silent_fallback]])。

import { spawn } from 'node:child_process';

export interface RunClaudeOpts {
  /** --model に渡す値。エイリアス ('haiku'|'sonnet'|'opus') でもフルモデル ID でも可。 */
  model?: string;
  /** --allowedTools に渡すツール名 (例 ['Read'])。print mode で画像読取を許可する用途。 */
  allowedTools?: string[];
  /** --add-dir に渡す追加許可ディレクトリ (画像の置き場所など)。 */
  addDirs?: string[];
  /** claude バイナリのパス (既定 'claude')。 */
  cliPath?: string;
  /** 中断用シグナル (abort で子プロセス kill)。 */
  signal?: AbortSignal;
  /** タイムアウト (ms)。超過で kill して例外。既定 120000。 */
  timeoutMs?: number;
}

/** shell:true で起動するため、空白や " を含む引数を防御的にクオートする。 */
function quoteArg(a: string): string {
  return /[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a;
}

/**
 * claude CLI を print mode で 1 回呼び、応答テキスト全体 (trim 済) を返す。
 * env はそのまま継承する。
 */
export function runClaudeCli(prompt: string, opts: RunClaudeOpts = {}): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const rawArgs = ['-p'];
    if (opts.model) rawArgs.push('--model', opts.model);
    if (opts.allowedTools && opts.allowedTools.length > 0) {
      rawArgs.push('--allowedTools', opts.allowedTools.join(','));
    }
    for (const d of opts.addDirs ?? []) rawArgs.push('--add-dir', d);

    const args = rawArgs.map(quoteArg);
    const cli = opts.cliPath ?? 'claude';

    const child = spawn(cli, args, { shell: true, stdio: ['pipe', 'pipe', 'pipe'] });

    let out = '';
    let err = '';
    let settled = false;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d: string) => {
      out += d;
    });
    child.stderr.on('data', (d: string) => {
      err += d;
    });

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error(`claude CLI timed out after ${opts.timeoutMs ?? 120_000}ms`));
    }, opts.timeoutMs ?? 120_000);

    const onAbort = () => child.kill();
    if (opts.signal) {
      if (opts.signal.aborted) child.kill();
      else opts.signal.addEventListener('abort', onAbort);
    }

    const cleanup = () => {
      clearTimeout(timer);
      if (opts.signal) opts.signal.removeEventListener('abort', onAbort);
    };

    child.on('error', (e) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`claude CLI 起動失敗 (${cli}): ${(e as Error).message}`));
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (code === 0) {
        resolve(out.trim());
      } else {
        const detail = (err || out).trim().slice(0, 800);
        reject(new Error(`claude CLI exited with ${code ?? 'null'}: ${detail}`));
      }
    });

    child.stdin.end(prompt, 'utf8');
  });
}

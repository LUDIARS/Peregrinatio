// 時刻表/運行情報プロバイダの選択 (factory)。閉じた集合なので switch で十分。
//   - 既定: ekispert キーが設定済なら 'ekispert'、無ければ 'crawl-llm'。
//   - 明示要求でキー未設定の ekispert を選ぶと ProviderUnavailableError (= 501)。silent fallback しない。

import type { Config } from '../config.js';
import { CrawlLlmProvider } from './crawl-llm.js';
import { EkispertProvider } from './ekispert.js';
import {
  type ProviderKind,
  type TransitProvider,
  PROVIDER_KINDS,
  ProviderInputError,
  ProviderUnavailableError,
} from './provider.js';

export {
  type TransitProvider,
  type ProviderKind,
  ProviderInputError,
  ProviderUnavailableError,
  ProviderFetchError,
} from './provider.js';

/** ekispert キーがあればそれを既定に、無ければ crawl-llm。 */
export function defaultProviderKind(config: Config): ProviderKind {
  return config.transit.ekispertKey ? 'ekispert' : 'crawl-llm';
}

function build(kind: ProviderKind, config: Config): TransitProvider {
  switch (kind) {
    case 'crawl-llm':
      return new CrawlLlmProvider(config);
    case 'ekispert':
      if (!config.transit.ekispertKey) {
        throw new ProviderUnavailableError(
          'ekispert (駅すぱあと) の API キーが未設定です',
          'npm run config-set EKISPERT_API_KEY <値> で登録すると有効化します。',
        );
      }
      return new EkispertProvider(
        config.transit.ekispertKey,
        config.transit.ekispertBaseUrl,
        config.crawl.fetchTimeoutMs,
      );
    default: {
      const _exhaustive: never = kind;
      throw new Error(`unknown provider kind: ${String(_exhaustive)}`);
    }
  }
}

/**
 * リクエストの provider 指定 (任意) と config から TransitProvider を解決する。
 * 未指定なら defaultProviderKind。未知の指定は ProviderInputError (= 400)。
 */
export function resolveProvider(requested: string | undefined, config: Config): TransitProvider {
  const kind = (requested?.trim() || defaultProviderKind(config)) as ProviderKind;
  if (!PROVIDER_KINDS.includes(kind)) {
    throw new ProviderInputError(
      `未知のプロバイダです: ${requested}`,
      `指定可能: ${PROVIDER_KINDS.join(' | ')}`,
    );
  }
  return build(kind, config);
}

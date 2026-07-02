import type { TransitProviderKind } from '../../types.js';

export const PROVIDER_LABEL: Record<TransitProviderKind, string> = {
  'crawl-llm': 'URL から自動抽出',
  ekispert: '駅すぱあと',
};

/** 時刻表/運行情報の自動取得設定 (サーバ /api/transit/config の UI 表現)。 */
export interface TransitCfg {
  providers: TransitProviderKind[];
  default: TransitProviderKind;
  ekispertEnabled: boolean;
}

/** 取得方法 (provider) と (crawl-llm のときの) 取得元 URL の入力。 */
export function ProviderPicker({
  cfg, provider, setProvider, url, setUrl, urlPlaceholder,
}: {
  cfg: TransitCfg;
  provider: TransitProviderKind;
  setProvider: (p: TransitProviderKind) => void;
  url: string;
  setUrl: (u: string) => void;
  urlPlaceholder: string;
}) {
  return (
    <>
      {cfg.providers.length > 1 && (
        <select value={provider} onChange={(e) => setProvider(e.target.value as TransitProviderKind)} aria-label="取得方法">
          {cfg.providers.map((p) => <option key={p} value={p}>{PROVIDER_LABEL[p]}</option>)}
        </select>
      )}
      {provider === 'crawl-llm' && (
        <input
          type="url"
          placeholder={urlPlaceholder}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          style={{ flex: 1, minWidth: 160 }}
        />
      )}
    </>
  );
}

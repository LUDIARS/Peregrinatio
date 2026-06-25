# interface/ — API・外部連携

サービスの外部接点 (境界=contract) を書く。内部実装ではなく契約を記す。
REST/WebSocket/gRPC/IPC/CLI のエンドポイント (メソッド・パス・req/res・エラー)、
認証・認可境界 (Cernere)、外部サービス連携、イベント/Webhook ペイロードを記載する。

> ライブラリなら公開 export (関数/型のシグネチャ) が contract。

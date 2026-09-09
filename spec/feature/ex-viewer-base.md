# Ex Viewer のベースパス

Ex Viewer 内で画面を開いた場合、Ex が注入する script[data-excubitor-viewer] の
data-prefix を BrowserRouter の basename として使用する。直接アクセス時には
この属性が存在しないため従来のルーティングを維持する。

共通メニュー・通信の中継・Cookie変換は Ex が所有し、このサービスは画面ルートのみを所有する。
サービスへの認可や業務状態は変更しない。Ex Viewer と組み合わせて配備する。
元に戻す場合は basename 属性を外す。直接アクセスは継続して使用できる。

配備時には Ex Viewer 配下での画面遷移とログイン、および従来の直接アクセスが
継続して使用できることを確認する。

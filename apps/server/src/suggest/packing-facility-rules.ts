// 設備・行き先の特徴 → 荷物への効果 (純データ + 純関数)。
// 照合対象は「拠点の設備 (place_facilities)」と「旅の場所の名前/カテゴリ」の両方。
// 宿の設備だけでなく、海水浴場やスキー場のような行き先そのものからも持ち物が決まるため。
//
// 効果は 3 方向:
//   add          … 持っていくもの
//   drop         … 現地にあるので持っていかなくてよいもの (荷物を減らす)
//   clothingCap  … 着替えの上限枚数 (乾燥機・コインランドリー)

/** ルールが足す荷物 1 件。 */
export interface FacilityPackingItem {
  title: string;
  category: string;
  /** 固定数量。null は数量なし。perNight が true なら泊数から算出する。 */
  quantity?: number | null;
  perNight?: boolean;
  reason: string;
}

/** 現地にあるので持参不要なもの。 */
export interface FacilityPackingDrop {
  title: string;
  reason: string;
}

export interface FacilityPackingRule {
  id: string;
  /** 由来ラベル (UI のチップ。例: 乾燥機)。 */
  label: string;
  /** 設備名・場所名・カテゴリに対して照合する。 */
  match: RegExp;
  add?: FacilityPackingItem[];
  drop?: FacilityPackingDrop[];
  /** 着替えをこの枚数まで減らす。複数ルールが競合したら最小値を採る。 */
  clothingCap?: number;
}

export const FACILITY_PACKING_RULES: FacilityPackingRule[] = [
  {
    id: 'laundry',
    label: '乾燥機',
    match: /(乾燥機|洗濯機|コインランドリー|ランドリー|laundry|dryer|washing[_ ]?machine)/i,
    clothingCap: 2,
    add: [
      { title: '洗濯洗剤 (小分け)', category: '洗濯', quantity: 1, reason: '現地で洗えるので、着替えを減らす代わりに洗剤を持つ。' },
      { title: '洗濯ネット', category: '洗濯', quantity: 1, reason: '共用洗濯機で衣類を傷めないため。' },
      { title: '小銭 (洗濯機用)', category: '洗濯', quantity: null, reason: 'コインランドリーは現金のみのことが多い。' },
    ],
  },
  {
    id: 'pool_sea',
    label: 'プール・海',
    match: /(プール|pool|海水浴|ビーチ|beach|海岸|砂浜|水族|ウォーター\s?パーク|スパリゾート|swimming)/i,
    add: [
      { title: '水着', category: '水まわり', quantity: 1, reason: 'プール・海の利用があるため。' },
      { title: 'ラッシュガード', category: '水まわり', quantity: 1, reason: '日焼けと擦れを防ぐ。屋外プール・海では実質必須。' },
      { title: 'ビーチサンダル', category: '水まわり', quantity: 1, reason: '濡れた床と砂浜を歩くため。' },
      { title: '防水ポーチ', category: '水まわり', quantity: 1, reason: 'スマホと鍵を水濡れから守る。' },
      { title: '濡れ物用の袋', category: '水まわり', quantity: 2, reason: '濡れた水着を持ち帰るため。' },
    ],
  },
  {
    id: 'onsen',
    label: '大浴場・温泉',
    match: /(温泉|大浴場|露天風呂|風呂|湯|sauna|サウナ|spa|岩盤浴)/i,
    add: [
      { title: '湯上がり用ヘアゴム', category: '入浴', quantity: 1, reason: '大浴場では髪をまとめる必要がある。' },
      { title: '小さめの巾着', category: '入浴', quantity: 1, reason: '客室から浴場へ小物を運ぶため。' },
    ],
    drop: [
      { title: 'バスタオル', reason: '大浴場・温泉が備え付けのため、持参しなくてよい。' },
    ],
  },
  {
    id: 'amenity',
    label: 'アメニティ',
    match: /(アメニティ|amenit)/i,
    drop: [
      { title: '歯ブラシ', reason: '宿のアメニティにあるため。' },
      { title: 'シャンプー', reason: '宿のアメニティにあるため。' },
      { title: 'ドライヤー', reason: '客室・浴場に備え付けのため。' },
    ],
  },
  {
    id: 'toothbrush',
    label: '歯ブラシ',
    match: /(歯ブラシ|toothbrush)/i,
    drop: [{ title: '歯ブラシ', reason: '宿のアメニティにあるため。' }],
  },
  {
    id: 'shampoo',
    label: 'シャンプー',
    match: /(シャンプー|shampoo)/i,
    drop: [{ title: 'シャンプー', reason: '宿のアメニティにあるため。' }],
  },
  {
    id: 'hair_dryer',
    label: 'ドライヤー',
    match: /(ドライヤー|hair\s?dryer)/i,
    drop: [{ title: 'ドライヤー', reason: '客室・浴場に備え付けのため。' }],
  },
  {
    id: 'gym',
    label: 'ジム',
    match: /(ジム|フィットネス|gym|fitness|トレーニング)/i,
    add: [
      { title: '運動着', category: '衣類', quantity: 1, reason: '館内ジムを使うため。' },
      { title: '室内用スニーカー', category: '靴', quantity: 1, reason: 'ジムは館内履きでは入れないことが多い。' },
    ],
  },
  {
    id: 'workspace',
    label: 'Wi-Fi・作業',
    match: /(wi-?fi|ワークスペース|コワーキング|デスク|ビジネス|会議|work)/i,
    add: [
      { title: 'ノート PC と充電器', category: '電子機器', quantity: 1, reason: '滞在中に作業する前提の設備があるため。' },
      { title: '延長タップ', category: '電子機器', quantity: 1, reason: '客室のコンセントが足りないことが多い。' },
    ],
  },
  {
    id: 'kitchen',
    label: 'キッチン',
    match: /(キッチン|自炊|調理|kitchen|電子レンジ|冷蔵庫|バーベキュー|BBQ)/i,
    add: [
      { title: '食材メモ・調味料', category: '食事', quantity: null, reason: '自炊できる設備があるため。' },
      { title: 'ジッパー袋', category: '食事', quantity: 3, reason: '余った食材の保存に使う。' },
    ],
  },
  {
    id: 'ski',
    label: 'スキー・雪山',
    match: /(スキー|スノーボード|ゲレンデ|雪山|ski|snowboard|スノーパーク)/i,
    add: [
      { title: 'ゴーグル', category: 'アクティビティ', quantity: 1, reason: '雪面の照り返しと吹雪に備える。' },
      { title: '防水手袋', category: 'アクティビティ', quantity: 1, reason: '濡れると一気に体温を持っていかれる。' },
      { title: 'ニット帽・ネックウォーマー', category: '衣類', quantity: 1, reason: 'リフト待ちの冷え対策。' },
      { title: '日焼け止め', category: '肌', quantity: 1, reason: '雪面の反射で標高が高いほど焼ける。' },
    ],
  },
  {
    id: 'hiking',
    label: '山・トレッキング',
    match: /(登山|ハイキング|トレッキング|山道|渓谷|滝|hiking|trail|自然歩道)/i,
    add: [
      { title: '歩きやすい靴', category: '靴', quantity: 1, reason: '未舗装路を歩くため。' },
      { title: '飲み物 (多め)', category: '食事', quantity: null, reason: '売店の無い区間が長いことがある。' },
      { title: '絆創膏', category: '救急', quantity: null, reason: '靴擦れの初動用。' },
    ],
  },
  {
    id: 'theme_park',
    label: 'テーマパーク',
    match: /(テーマパーク|遊園地|amusement|アトラクション|パレード|園内)/i,
    add: [
      { title: 'モバイルバッテリー', category: '電子機器', quantity: 1, reason: 'アプリの待ち時間確認と撮影で電池が尽きる。' },
      { title: '折りたたみレジャーシート', category: 'アクティビティ', quantity: 1, reason: 'パレード待ちの座り場所に使う。' },
    ],
  },
  {
    id: 'shrine_museum',
    label: '寺社・美術館',
    match: /(神社|寺|寺院|仏閣|城|美術館|博物館|庭園|museum|shrine|temple)/i,
    add: [
      { title: '御朱印帳', category: '記録', quantity: 1, reason: '寺社を巡るため (集めている場合)。' },
      { title: '脱ぎ履きしやすい靴', category: '靴', quantity: 1, reason: '拝観で靴を脱ぐ場面が多い。' },
    ],
  },
  {
    id: 'parking',
    label: '駐車場・車',
    match: /(駐車場|parking|レンタカー|ドライブ|\bcar\b)/i,
    add: [
      { title: '運転免許証', category: '貴重品', quantity: 1, reason: '車移動があるため。' },
      { title: 'ETC カード', category: '貴重品', quantity: 1, reason: '高速道路を使う場合に必要。' },
    ],
  },
];

/**
 * 設備名・場所名の一覧から、当てはまるルールを引く。
 * 1 ルールにつき最初に当たった特徴を由来ラベルの補足として返す。
 */
export function matchFacilityRules(features: string[]): Array<{ rule: FacilityPackingRule; matched: string[] }> {
  const hits: Array<{ rule: FacilityPackingRule; matched: string[] }> = [];
  for (const rule of FACILITY_PACKING_RULES) {
    const matched = features.filter((f) => rule.match.test(f));
    if (matched.length > 0) hits.push({ rule, matched });
  }
  return hits;
}

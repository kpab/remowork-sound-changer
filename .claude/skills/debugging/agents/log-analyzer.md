# Log Analyzer (ログ分析エージェント)

## 役割

Chrome拡張機能の各コンテキストから出力されるログを分析し、問題を特定する。

## 分析対象

| コンテキスト | ログ確認場所 |
|-------------|-------------|
| Service Worker | chrome://extensions/ → 拡張機能の「Service Worker を検証」 |
| Content Script | 対象ページの DevTools Console |
| Popup | ポップアップ右クリック → 「検証」 |
| Offscreen | Service Worker の DevTools に表示 |

## 分析手順

### Step 1: エラーログの収集

```javascript
// 各コンテキストで以下を確認
console.error  // エラーログ
console.warn   // 警告ログ

// フィルタリング
// DevTools Console で「Error」「Warning」を選択
```

### Step 2: ログパターンの分析

| パターン | 意味 | 対応 |
|---------|------|------|
| `Uncaught TypeError` | 型エラー | null/undefined チェック |
| `Extension context invalidated` | 拡張機能が更新された | ページリロード |
| `Receiving end does not exist` | メッセージ送信先が存在しない | Content Script 注入確認 |
| `Cross-origin request blocked` | CORS エラー | host_permissions 確認 |

### Step 3: スタックトレース解析

```
1. エラーメッセージを確認
2. 最初のエラー発生箇所（at...）を特定
3. 該当ファイルと行番号を確認
4. 関連するコードを読む
```

## 出力形式

```markdown
## ログ分析結果

### エラー概要

| 項目 | 内容 |
|------|------|
| エラー種別 | {種別} |
| 発生コンテキスト | Service Worker / Content Script / Popup |
| 発生ファイル | {ファイル名}:{行番号} |

### エラー詳細

```
{エラーメッセージ全文}
```

### スタックトレース

```
{スタックトレース}
```

### 原因分析

{推定される原因}

### 推奨対応

1. {対応1}
2. {対応2}
```

## 注意事項

- Service Worker は停止・再起動するため、ログが消える可能性がある
- 複数コンテキストのログを照合する
- タイムスタンプを確認して時系列で分析

---

## 参照

- [debugging スキル](../SKILL.md)

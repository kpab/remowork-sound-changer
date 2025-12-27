---
name: chrome-extension-dev
description: |
  Chrome拡張機能の開発ガイドライン。
  Manifest V3準拠、セキュリティ、パフォーマンス最適化。
  発動キーワード: Chrome拡張、extension、manifest、content script、background script
allowed-tools: Read, Grep, Glob, Edit, Write, Bash
version: 1.3.0
updated: 2025-12-27
---

# Chrome Extension Development

## 概要

Chrome拡張機能開発のベストプラクティスとガイドライン。

## 使用タイミング

- 新規Chrome拡張機能の作成
- 既存拡張機能のManifest V3移行
- Content Script / Background Script の実装
- 拡張機能のデバッグ

## Manifest V3 必須構造

```json
{
  "manifest_version": 3,
  "name": "Extension Name",
  "version": "1.0.0",
  "description": "説明",
  "permissions": [],
  "host_permissions": [],
  "background": {
    "service_worker": "background.js"
  },
  "action": {
    "default_popup": "popup.html",
    "default_icon": {}
  },
  "content_scripts": [],
  "web_accessible_resources": []
}
```

## 主要なパターン

### 1. Content Script → Background 通信

```javascript
// content.js
chrome.runtime.sendMessage({ type: 'getData', key: 'foo' }, (response) => {
  console.log(response);
});

// background.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'getData') {
    // 処理
    sendResponse({ success: true, data: result });
  }
  return true; // 非同期レスポンスの場合
});
```

### 2. ページコンテキストへの注入

```javascript
// content.js
const script = document.createElement('script');
script.src = chrome.runtime.getURL('inject.js');
(document.head || document.documentElement).appendChild(script);
script.onload = () => script.remove();
```

### 3. IndexedDB ストレージ

```javascript
const DB_NAME = 'ExtensionDB';
const STORE_NAME = 'data';

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
  });
}
```

## Checklist

### 新規作成時
- [ ] Manifest V3 準拠
- [ ] 最小限の permissions
- [ ] icons（16, 48, 128px）
- [ ] popup.html の CSP 準拠

### セキュリティ
- [ ] 外部スクリプト読み込み禁止
- [ ] ユーザー入力のサニタイズ
- [ ] eval() 使用禁止
- [ ] innerHTML 使用時の注意

### パフォーマンス
- [ ] Service Worker の軽量化
- [ ] 不要な権限の削除
- [ ] ストレージ使用量の最適化

## テストルール

### ブラックボックス単体テスト（必須）

**機能開発後は必ずブラックボックステストを作成する。**

#### テスト方針
- **ブラックボックステスト**: 内部実装を知らない前提で、入出力のみを検証
- **単体テスト**: 各関数・モジュールを独立してテスト
- テストフレームワーク: Jest または Vitest 推奨

#### テストファイル構成
```
remowork-sound-changer/
├── tests/                    # テストディレクトリ
│   ├── unit/                 # 単体テスト
│   │   ├── background.test.js
│   │   ├── popup.test.js
│   │   └── utils.test.js
│   └── setup.js              # テストセットアップ
├── jest.config.js            # Jest設定（使用時）
└── vitest.config.js          # Vitest設定（使用時）
```

#### テスト作成ルール
1. **関数ごとにテストを作成** - 公開関数は必ずテスト対象
2. **境界値テスト** - 最小値、最大値、空配列、null等をテスト
3. **異常系テスト** - エラーケース、例外処理をテスト
4. **モック活用** - chrome.* API、外部依存はモック化

#### テスト例
```javascript
// tests/unit/utils.test.js
describe('formatVersion', () => {
  // 正常系
  test('バージョン文字列を正しくフォーマットする', () => {
    expect(formatVersion('1.2.3')).toBe('v1.2.3');
  });

  // 境界値
  test('空文字列の場合はデフォルト値を返す', () => {
    expect(formatVersion('')).toBe('v0.0.0');
  });

  // 異常系
  test('nullの場合は例外をスローする', () => {
    expect(() => formatVersion(null)).toThrow();
  });
});
```

#### Chrome API モック
```javascript
// tests/setup.js
global.chrome = {
  runtime: {
    sendMessage: jest.fn(),
    onMessage: { addListener: jest.fn() },
    getURL: jest.fn((path) => `chrome-extension://mock-id/${path}`)
  },
  storage: {
    local: {
      get: jest.fn(),
      set: jest.fn()
    }
  }
};
```

### テスト実行タイミング
- **機能実装完了後** - 必ずテストを作成・実行
- **コードレビュー前** - テストがパスすることを確認
- **リリース前** - 全テストがパスすることを確認

## バージョニングルール

### セマンティックバージョニング

形式: `MAJOR.MINOR.PATCH` (例: 1.2.1)

| 種別 | 更新タイミング | 例 |
|------|---------------|-----|
| MAJOR (1.x.x) | 大きな機能追加、破壊的変更 | 新機能カテゴリ追加 |
| MINOR (x.2.x) | 機能追加・改善 | 新しいUI機能、API連携 |
| PATCH (x.x.1) | バグ修正、軽微な変更 | タイポ修正、スタイル調整 |

### コミット時の更新必須項目

**毎回のコミット時に必ず以下を更新する：**

1. `manifest.json` の `version` を更新
2. `popup.html` のフッター `v1.x.x` を更新
3. `CHANGELOG.md` にリリースノートを追記
4. コミット後、ZIPファイルにバージョン名を含めて作成

### 重要: プッシュ前のレビュー必須

**コードレビューが完了するまで `git push` は実行しない。**

1. コード変更完了後、12視点マトリックスレビューを実行
2. ユーザーの確認・承認を得てからプッシュ
3. 勝手にプッシュしない

---

## コードレビュー

**機能完成時に必ず実行する。** 4つの視点でコードをレビューする。

### レビュー結果テンプレート

```markdown
## コードレビュー結果

**対象**: {機能名/ファイル}
**日時**: {YYYY-MM-DD}

### 1. Claude Code 視点（技術品質）

| 項目 | 状態 | 詳細 |
|------|------|------|
| CLAUDE.md参照可能 | ✅/⚠️/❌ | スキル・ルールを正しく参照できるか |
| Manifest V3準拠 | ✅/⚠️/❌ | {詳細} |
| エラーハンドリング | ✅/⚠️/❌ | {詳細} |
| 非同期処理 | ✅/⚠️/❌ | {詳細} |
| console.log残存 | ✅/⚠️/❌ | {詳細} |
| パフォーマンス | ✅/⚠️/❌ | {詳細} |

### 2. antigravity 視点（アーキテクチャ・セキュリティ）

| 項目 | 状態 | 詳細 |
|------|------|------|
| プロジェクトルール参照可能 | ✅/⚠️/❌ | 固有ルールを正しく参照できるか |
| CSP準拠 | ✅/⚠️/❌ | {詳細} |
| XSS対策 | ✅/⚠️/❌ | {詳細} |
| eval()使用禁止 | ✅/⚠️/❌ | {詳細} |
| 最小限のpermissions | ✅/⚠️/❌ | {詳細} |
| 通信フロー整合性 | ✅/⚠️/❌ | {詳細} |

### 3. Claude AI 視点（ドキュメント・整合性）

| 項目 | 状態 | 詳細 |
|------|------|------|
| スキル参照可能 | ✅/⚠️/❌ | 関連スキルを正しく参照できるか |
| CLAUDE.mdルール準拠 | ✅/⚠️/❌ | {詳細} |
| 関連スキルのルール準拠 | ✅/⚠️/❌ | {詳細} |
| コードの自己文書化 | ✅/⚠️/❌ | {詳細} |
| 命名規則 | ✅/⚠️/❌ | {詳細} |

### 4. ユーザー視点（UX・業務適合性）

| 項目 | 状態 | 詳細 |
|------|------|------|
| ローディング表示 | ✅/⚠️/❌ | 処理中にユーザーへフィードバックがあるか |
| エラーメッセージ | ✅/⚠️/❌ | ユーザーが理解・対処できるメッセージか |
| 操作の一貫性 | ✅/⚠️/❌ | 既存機能と操作感が統一されているか |
| レスポンス速度 | ✅/⚠️/❌ | ユーザーがストレスなく操作できるか |

## 総合評価: PASS / NEEDS REVISION

### 良い点
- {良い点1}

### 修正必要項目（NEEDS REVISION の場合）
| # | 優先度 | ファイル:行番号 | 内容 |
|---|--------|----------------|------|
| 1 | 高 | path/to/file:123 | {修正内容} |
```

### CHANGELOG.md フォーマット

**リリースノートは以下の形式で記載：**

```markdown
## v1.2.9 - ハンドサイン検出オフ時にウィジェットが非表示になるバグを修正
- 「他のメンバーの手を検出して通知」をオフにしてもウィジェットは表示され続ける
- 事前撮影、録音などの機能は引き続き利用可能

## v1.2.8 - Whisperの幻覚（無音時の誤認識）をフィルタリング
- 「ご視聴ありがとう」「最後までご覧いただき」等のYouTube風エンディングを除外
- 「チャンネル登録」「高評価」等のプロモーション文を除外
```

**ルール：**
- 見出し: `## v{バージョン} - {変更の要約（1行）}`
- 詳細: 箇条書きで具体的な変更内容を記載
- 新しいバージョンを上に追記していく

## デプロイ手順

### コード変更後のワークフロー

```bash
# 1. manifest.json と popup.html のバージョンを更新
# manifest.json: "version": "1.2.1" → "1.2.2"
# popup.html: <p class="version">v1.2.1</p> → v1.2.2

# 2. 変更をコミット・プッシュ
cd /Users/k.matsukawa/dev/docker/chrome-extension/remowork-sound-changer
git add -A
git commit -m "feat/fix: 変更内容の説明"
git push

# 3. zipファイルを prod/[アプリ名]/ に作成（バージョン名を含める）
zip -r ../prod/remowork-sound-changer/remowork-sound-changer-v1.2.2.zip . -x "*.git*" -x "*.DS_Store"
```

### ZIPファイル保存先

**配布用ZIPは `prod/[アプリ名]/` に保存:**
```
chrome-extension/
└── prod/
    └── remowork-sound-changer/
        ├── remowork-sound-changer-v1.2.0.zip
        ├── remowork-sound-changer-v1.2.1.zip
        └── remowork-sound-changer-v1.2.2.zip  # 最新
```

### ZIPファイル命名規則

**必ずバージョン番号を含める:**
- 正: `remowork-sound-changer-v1.2.1.zip`
- 誤: `remowork-sound-changer.zip`

### 重要なポイント
- `.git/` フォルダはzipから除外
- `.DS_Store` ファイルも除外
- sounds/ フォルダはzipには含まれるが、GitHubには含まれない（.gitignoreで除外）
- **ZIPファイル名にバージョン番号を必ず含める**
- **ZIPは `prod/[アプリ名]/` ディレクトリに保存**

## Troubleshooting

### Service Worker が起動しない
1. `chrome://extensions/` で拡張機能を確認
2. 「Service Worker を検証」でエラーログ確認
3. manifest.json の構文エラーチェック

### Content Script が動作しない
1. `matches` パターンを確認
2. ページをリロード
3. コンソールでエラー確認

### 通信が届かない
1. `chrome.runtime.lastError` をチェック
2. `return true` を非同期処理に追加
3. sender.tab が undefined でないか確認

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.3.0 | 2025-12-27 | ブラックボックス単体テストルール追加 |
| 1.2.0 | 2025-12-25 | CHANGELOG.md更新ルール追加 |
| 1.1.0 | 2025-12-25 | バージョニングルール追加、ZIP命名規則追加 |
| 1.0.0 | 2024-12-24 | 初版作成 |

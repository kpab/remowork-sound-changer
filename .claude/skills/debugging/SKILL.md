---
name: debugging
description: |
  Chrome拡張機能のバグ調査・デバッグ時に使用するスキル。
  「デバッグ」「バグ」「エラー」「不具合」「動かない」で自動発動。
  問題切り分け、ログ分析、再現手順確認を提供。
allowed-tools: Read, Grep, Glob, Bash
version: 1.0.0
updated: 2024-12-27
---

# デバッグスキル (Chrome拡張機能向け)

## 概要

Chrome拡張機能のバグ調査・デバッグのためのルールとチェックリスト。
Service Worker、Content Script、Popup間の問題切り分けをカバー。

## 使用タイミング

- バグ報告を受けた時
- コンソールにエラーが出る時
- 拡張機能が期待通り動作しない時
- Content Scriptが注入されない時

---

## 使用宣言

**このスキルを使用する場合、作業開始時に以下を宣言すること:**

```
このタスクでは debugging スキルを使用します。
参照: .claude/skills/debugging/SKILL.md
```

---

## デバッグフロー

```
1. 問題の理解・再現
    ↓
2. エラーログ確認（どのコンテキストで発生？）
    ↓
3. 問題箇所の切り分け
    ↓
4. 仮説立案・検証
    ↓
5. 修正・テスト
```

---

## Chrome拡張のデバッグポイント

### 各コンテキストのログ確認方法

| コンテキスト | 確認方法 |
|-------------|---------|
| Service Worker | chrome://extensions/ → 拡張機能の「Service Worker を検証」 |
| Content Script | 対象ページでF12 → Console |
| Popup | ポップアップ右クリック → 「検証」 |
| Offscreen | Service Worker のDevToolsに表示 |

### よくある問題と確認ポイント

| 問題 | 確認ポイント |
|------|-------------|
| Content Script が動かない | manifest.json の matches パターン |
| メッセージが届かない | sendMessage/onMessage の対応 |
| ストレージが読めない | storage パーミッション、非同期処理 |
| 音声が再生されない | web_accessible_resources の設定 |
| Service Worker が停止 | 永続化されていないことを理解 |

---

## Step 1: 問題の理解・再現

### 確認事項

| 項目 | 質問 |
|------|------|
| 現象 | 何が起きているか？ |
| 期待動作 | 本来どうなるべきか？ |
| 再現手順 | どうすれば再現できるか？ |
| ブラウザ | Chrome バージョンは？ |
| 発生時期 | いつから発生？更新後？ |

### 再現確認

```javascript
// Console で状態確認
chrome.storage.local.get(null, console.log);
chrome.runtime.getManifest();
```

---

## Step 2: エラーログ確認

### Service Worker のログ

```javascript
// background.js にデバッグログを追加
console.log('[BG] Service Worker started');

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  console.log('[BG] Message received:', msg, 'from:', sender.tab?.url);
  // ...
});
```

### Content Script のログ

```javascript
// content.js にデバッグログを追加
console.log('[CS] Content script injected on:', location.href);

// メッセージ送信時
chrome.runtime.sendMessage({ type: 'TEST' })
  .then(res => console.log('[CS] Response:', res))
  .catch(err => console.error('[CS] Error:', err));
```

### Popup のログ

```javascript
// popup.js
console.log('[PU] Popup opened');
```

---

## Step 3: 問題箇所の切り分け

### コンテキスト間の通信確認

```
1. Content Script → Service Worker
   - sendMessage が呼ばれているか？
   - onMessage.addListener が設定されているか？
   - sendResponse / return true が正しいか？

2. Popup → Service Worker
   - 同上

3. Service Worker → Content Script
   - tabs.sendMessage の tabId は正しいか？
   - Content Script はそのタブで動いているか？
```

### Manifest 設定確認

```javascript
// manifest.json の重要な設定
{
  "content_scripts": [{
    "matches": ["https://example.com/*"],  // パターンは正しいか？
    "js": ["content.js"],
    "run_at": "document_idle"  // 実行タイミングは適切か？
  }],
  "permissions": ["storage", "tabs"],  // 必要なパーミッション
  "host_permissions": ["https://example.com/*"]  // ホストパーミッション
}
```

---

## Step 4: よくある問題と解決策

### Content Script が注入されない

**原因:** matches パターンが間違っている

```javascript
// ❌ 間違い
"matches": ["https://example.com"]  // /* がない

// ✅ 正解
"matches": ["https://example.com/*"]
```

**確認方法:**
```javascript
// Console で確認
chrome.runtime.getManifest().content_scripts
```

### メッセージが届かない

**原因:** 非同期レスポンスで return true がない

```javascript
// ❌ 間違い
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  doAsyncWork().then(result => {
    sendResponse(result);
  });
  // return true がない！
});

// ✅ 正解
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  doAsyncWork().then(result => {
    sendResponse(result);
  });
  return true;  // 非同期レスポンスを示す
});
```

### Service Worker が停止する

**原因:** Service Worker は非活動状態で停止する（仕様）

```javascript
// 長時間処理はサポートされていない
// 定期的な処理は chrome.alarms を使用

// ❌ 間違い
setInterval(() => { /* ... */ }, 60000);

// ✅ 正解
chrome.alarms.create('myAlarm', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'myAlarm') {
    // 処理
  }
});
```

### ストレージが読めない

**原因:** 非同期APIをPromiseで扱っていない

```javascript
// ❌ 間違い（コールバックスタイル混在）
const data = chrome.storage.local.get('key');

// ✅ 正解（async/await）
const result = await chrome.storage.local.get('key');
const data = result.key;

// ✅ 正解（Promise）
chrome.storage.local.get('key').then(result => {
  const data = result.key;
});
```

### CSP エラー

**原因:** インラインスクリプトがブロックされている

```javascript
// ❌ 間違い（popup.html）
<script>doSomething();</script>

// ✅ 正解（外部ファイル）
<script src="popup.js"></script>
```

---

## デバッグツール

### Chrome DevTools

```javascript
// ブレークポイント設定
debugger;

// オブジェクト詳細表示
console.dir(object);

// テーブル表示
console.table(array);

// スタックトレース
console.trace('Where am I?');

// グループ化
console.group('Group Name');
console.log('Item 1');
console.log('Item 2');
console.groupEnd();
```

### 拡張機能の状態確認

```javascript
// 拡張機能の情報
chrome.management.getSelf(console.log);

// インストール済み拡張機能一覧
chrome.management.getAll(console.log);

// 現在のタブ情報
chrome.tabs.query({ active: true, currentWindow: true }, console.log);
```

---

## サブエージェント

複雑な問題は専門サブエージェントに分析を依頼:

| エージェント | 用途 |
|-------------|------|
| [log-analyzer](./agents/log-analyzer.md) | ログ分析 |
| [code-tracer](./agents/code-tracer.md) | コード追跡 |
| [context-checker](./agents/context-checker.md) | コンテキスト間通信確認 |

---

## チェックリスト

| # | 観点 | 確認内容 | 重要度 |
|---|------|----------|--------|
| 1 | 再現 | 問題を再現できたか | 高 |
| 2 | コンテキスト | どのコンテキストでエラーか | 高 |
| 3 | Manifest | 設定は正しいか | 高 |
| 4 | パーミッション | 必要なパーミッションがあるか | 高 |
| 5 | 非同期 | async/await が正しいか | 高 |
| 6 | メッセージ | return true を返しているか | 中 |

---

## 関連スキル

| スキル | 用途 |
|--------|------|
| [chrome-extension-dev](../chrome-extension-dev/SKILL.md) | Chrome拡張開発ガイド |
| [research](../research/SKILL.md) | 技術調査 |

---

## Version History

| バージョン | 日付 | 変更内容 |
|-----------|------|----------|
| v1.0.0 | 2024-12-27 | 初版作成（Chrome拡張向け） |

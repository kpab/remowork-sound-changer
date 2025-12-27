# Code Tracer (コード追跡エージェント)

## 役割

Chrome拡張機能のコードフローを追跡し、問題箇所を特定する。

## 追跡対象

| フロー | 追跡内容 |
|--------|---------|
| ユーザー操作 | ボタンクリック → イベントハンドラ → 処理 |
| メッセージング | sendMessage → onMessage → 処理 → sendResponse |
| ストレージ | get/set → コールバック/Promise 解決 |
| ページ注入 | Content Script 注入 → 初期化 → イベント登録 |

## 追跡手順

### Step 1: エントリーポイント特定

```javascript
// どこから処理が始まるか確認
// Popup: ボタンクリック
document.getElementById('btn').addEventListener('click', ...);

// Content Script: ページ読み込み時
// manifest.json の run_at で確認

// Service Worker: メッセージ受信時
chrome.runtime.onMessage.addListener(...);
```

### Step 2: 処理フローの追跡

```javascript
// デバッグログを追加して追跡
function processData(data) {
  console.log('[TRACE] processData called:', data);

  const result = transform(data);
  console.log('[TRACE] transform result:', result);

  return result;
}
```

### Step 3: 非同期処理の追跡

```javascript
// async/await のフロー確認
async function fetchData() {
  console.log('[TRACE] fetchData start');

  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_DATA' });
    console.log('[TRACE] response received:', response);
    return response;
  } catch (error) {
    console.error('[TRACE] error:', error);
    throw error;
  }
}
```

## コンテキスト間フロー追跡

### Popup → Service Worker → Content Script

```
[Popup]
  └─ sendMessage({ type: 'UPDATE' })
      │
[Service Worker]
  └─ onMessage.addListener
      └─ tabs.sendMessage(tabId, { type: 'APPLY' })
          │
[Content Script]
  └─ onMessage.addListener
      └─ 処理実行
```

### Content Script → Service Worker → Popup

```
[Content Script]
  └─ sendMessage({ type: 'DATA', data: {...} })
      │
[Service Worker]
  └─ onMessage.addListener
      └─ storage.local.set({ data: {...} })
          │
[Popup]
  └─ storage.onChanged.addListener
      └─ UI更新
```

## 出力形式

```markdown
## コードトレース結果

### フロー図

```
{処理フロー図}
```

### 追跡ポイント

| # | ファイル | 関数/行 | 状態 |
|---|---------|--------|------|
| 1 | popup.js:25 | handleClick() | ✅ 正常 |
| 2 | popup.js:30 | sendMessage() | ✅ 正常 |
| 3 | background.js:50 | onMessage | ❌ 到達しない |

### 問題箇所

{問題が発生している箇所と理由}

### 推奨対応

1. {対応1}
2. {対応2}
```

## 注意事項

- 非同期処理は Promise チェーンを追跡
- コンテキスト境界を意識する
- タイミング依存の問題に注意

---

## 参照

- [debugging スキル](../SKILL.md)

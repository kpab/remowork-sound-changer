# Context Checker (コンテキスト間通信確認エージェント)

## 役割

Chrome拡張機能のコンテキスト間通信（メッセージング）が正しく動作しているか確認する。

## 確認対象

| 通信パターン | 送信側 | 受信側 |
|-------------|--------|--------|
| runtime.sendMessage | Content/Popup | Service Worker |
| tabs.sendMessage | Service Worker | Content Script |
| runtime.connect | 長期接続が必要な場合 | 双方向 |

## 確認手順

### Step 1: 送信側の確認

```javascript
// sendMessage が正しく呼ばれているか
chrome.runtime.sendMessage({ type: 'TEST', data: 'hello' })
  .then(response => {
    console.log('[SEND] Response:', response);
  })
  .catch(error => {
    console.error('[SEND] Error:', error);
  });
```

### Step 2: 受信側の確認

```javascript
// onMessage.addListener が正しく設定されているか
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[RECV] Message:', message);
  console.log('[RECV] Sender:', sender);

  // 非同期処理の場合は return true が必要
  if (message.type === 'TEST') {
    sendResponse({ status: 'ok' });
  }

  return true;  // 非同期レスポンスの場合必須
});
```

### Step 3: tabs.sendMessage の確認

```javascript
// tabId が正しいか確認
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  if (tabs[0]) {
    console.log('[TABS] Sending to tab:', tabs[0].id, tabs[0].url);

    chrome.tabs.sendMessage(tabs[0].id, { type: 'TEST' })
      .then(response => console.log('[TABS] Response:', response))
      .catch(error => console.error('[TABS] Error:', error));
  } else {
    console.error('[TABS] No active tab found');
  }
});
```

## よくある問題

### 1. Receiving end does not exist

**原因:**
- Content Script がそのタブで実行されていない
- Service Worker が停止している

**確認方法:**
```javascript
// Content Script が注入されているか確認
chrome.scripting.executeScript({
  target: { tabId: tabId },
  func: () => console.log('[CHECK] Content script check')
});
```

### 2. Extension context invalidated

**原因:**
- 拡張機能が更新/リロードされた

**対策:**
```javascript
// エラーハンドリングを追加
try {
  await chrome.runtime.sendMessage({ type: 'TEST' });
} catch (error) {
  if (error.message.includes('Extension context invalidated')) {
    // ページリロードを促す
    alert('拡張機能が更新されました。ページをリロードしてください。');
  }
}
```

### 3. 非同期レスポンスが届かない

**原因:**
- return true がない

**確認:**
```javascript
// ❌ 間違い
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  doAsyncWork().then(result => sendResponse(result));
  // return true がない！
});

// ✅ 正解
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  doAsyncWork().then(result => sendResponse(result));
  return true;  // 必須
});
```

## 出力形式

```markdown
## コンテキスト間通信確認結果

### 通信フロー

| # | 送信元 | 送信先 | メッセージ | 状態 |
|---|--------|--------|-----------|------|
| 1 | Popup | Service Worker | { type: 'GET_DATA' } | ✅ |
| 2 | Service Worker | Content Script | { type: 'APPLY' } | ❌ |

### 問題詳細

| 箇所 | 問題 | 原因 |
|------|------|------|
| #2 | tabs.sendMessage でエラー | Content Script 未注入 |

### 推奨対応

1. {対応1}
2. {対応2}
```

## チェックリスト

| # | 確認項目 | 確認 |
|---|---------|------|
| 1 | sendMessage が呼ばれているか | [ ] |
| 2 | onMessage.addListener が設定されているか | [ ] |
| 3 | 非同期処理で return true しているか | [ ] |
| 4 | tabs.sendMessage の tabId は正しいか | [ ] |
| 5 | Content Script はそのタブで実行されているか | [ ] |

---

## 参照

- [debugging スキル](../SKILL.md)

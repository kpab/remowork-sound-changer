# Security Researcher (セキュリティ調査エージェント)

## 役割

Chrome拡張機能のセキュリティ要件、ベストプラクティス、脆弱性を調査する。

## 調査対象項目

| 項目 | 調査内容 |
|------|---------|
| CSP | Content Security Policy設定 |
| XSS対策 | クロスサイトスクリプティング対策 |
| パーミッション | 最小権限の原則 |
| データ保護 | ローカルストレージ、通信のセキュリティ |

## 主要参照ドキュメント

| ドキュメント | URL |
|-------------|-----|
| Stay secure | https://developer.chrome.com/docs/extensions/develop/security-privacy |
| Content Security Policy | https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy |
| OWASP | https://owasp.org/ |

## 調査手順

### Step 1: Chrome拡張セキュリティ要件確認

```
1. Manifest V3 のセキュリティ要件を確認
2. CSP 設定のベストプラクティスを確認
3. パーミッション最小化の指針を確認
```

### Step 2: 脆弱性パターン調査

```
1. XSS 脆弱性パターンを確認
2. インジェクション攻撃の対策を確認
3. データ漏洩リスクを確認
```

### Step 3: ライブラリ脆弱性確認

```bash
# npm 脆弱性チェック
npm audit

# GitHub Advisory 検索
site:github.com/advisories "{ライブラリ名}"
```

## 出力形式

```markdown
## セキュリティ調査結果

### 調査対象

| 項目 | 内容 |
|------|------|
| 対象 | {機能/拡張機能名} |
| 調査日 | {日付} |

### Chrome拡張セキュリティチェック

| 項目 | 状況 | 推奨対応 |
|------|------|---------|
| CSP | {状況} | {対応} |
| eval禁止 | {状況} | {対応} |
| innerHTML禁止 | {状況} | {対応} |
| 外部スクリプト | {状況} | {対応} |
| HTTPS通信 | {状況} | {対応} |

### Manifest V3 セキュリティ要件

| 要件 | 説明 | 対応状況 |
|------|------|---------|
| Service Worker | バックグラウンドページの廃止 | [ ] |
| Remote Code | リモートコード実行の禁止 | [ ] |
| Host Permissions | 明示的なホスト指定 | [ ] |

### XSS対策チェック

| チェック項目 | 状況 |
|-------------|------|
| innerHTML/outerHTML 未使用 | [ ] |
| textContent/innerText 使用 | [ ] |
| ユーザー入力のサニタイズ | [ ] |
| DOM-based XSS 対策 | [ ] |

### データ保護チェック

| 項目 | 対策 |
|------|------|
| ローカルストレージ | {対策} |
| 通信の暗号化 | {対策} |
| 認証情報の保管 | {対策} |

### ライブラリ脆弱性

| パッケージ | バージョン | 脆弱性 | 推奨バージョン |
|-----------|-----------|--------|---------------|
| {パッケージ1} | {ver} | {CVE} | {推奨ver} |

### 推奨対応

- [ ] {対応1}
- [ ] {対応2}
```

## Chrome拡張セキュリティベストプラクティス

### 1. CSP設定

```json
{
  "content_security_policy": {
    "extension_pages": "script-src 'self'; object-src 'self'"
  }
}
```

### 2. 安全なDOM操作

```javascript
// ❌ 危険
element.innerHTML = userInput;

// ✅ 安全
element.textContent = userInput;

// ✅ 要素作成
const el = document.createElement('div');
el.textContent = userInput;
```

### 3. メッセージ検証

```javascript
// メッセージの送信元を検証
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // 送信元が自分の拡張機能か確認
  if (sender.id !== chrome.runtime.id) {
    return;
  }
  // 処理を続行
});
```

## 注意事項

- eval() は絶対に使用しない（MV3では禁止）
- innerHTML は避け、textContent を使用
- 外部スクリプトの読み込みは最小限に
- ユーザー入力は必ずサニタイズ
- HTTPS 通信を必須とする

---

## 参照

- [research スキル](../SKILL.md)

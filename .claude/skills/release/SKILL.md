---
name: release
description: |
  リリース（プッシュ・ZIP作成）の手順とルール。
  バージョン更新、CHANGELOG追記、コードレビュー、git push、ZIP作成を行う。
  発動キーワード: リリース、release、プッシュ、push、zip、デプロイ
allowed-tools: Read, Edit, Write, Bash, Glob
version: 1.1.0
updated: 2025-12-27
---

# Release / Deploy

## 概要

Chrome拡張機能のリリース手順。
バージョン更新からZIP作成までを一貫して行う。

## 重要ルール

**git push 前に必ず `code-review` スキルを使用して12視点マトリックスレビューを実施すること。**
レビューをパスするまでプッシュは禁止。

## 使用タイミング

- 機能追加・バグ修正が完了した時
- ユーザーに配布する準備が整った時

## リリース手順

### 1. バージョン更新

以下のファイルでバージョン番号を更新：

| ファイル | 更新箇所 |
|----------|----------|
| `manifest.json` | `"version": "1.x.x"` |
| `popup.html` | `<p class="version">v1.x.x</p>` |

### 2. CHANGELOG.md 追記

```markdown
## v1.x.x - 変更の要約（1行）
### 新機能 / 改善 / 修正
- 具体的な変更内容
  - 詳細な説明
```

### 3. 12視点マトリックスレビュー（必須）

**`code-review` スキルを呼び出してレビューを実施する。**

```
スキル呼び出し: code-review
```

レビュー結果が **PASS** の場合のみ次のステップへ進む。
**NEEDS REVISION** の場合は修正を行い、再度レビューを実施する。

### 4. Git コミット・プッシュ

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat/fix: 変更内容の説明 (v1.x.x)

- 変更点1
- 変更点2

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
git push
```

### 5. ZIP作成

```bash
# prod/[アプリ名]/ に保存
zip -r ../prod/remowork-sound-changer/remowork-sound-changer-v1.x.x.zip . \
  -x "*.git*" -x "*.DS_Store"
```

## バージョニングルール

| 種別 | 更新タイミング |
|------|---------------|
| MAJOR (1.x.x) | 大きな機能追加、破壊的変更 |
| MINOR (x.2.x) | 機能追加・改善 |
| PATCH (x.x.1) | バグ修正、軽微な変更 |

## チェックリスト

- [ ] manifest.json のバージョン更新
- [ ] popup.html のバージョン更新
- [ ] CHANGELOG.md にリリースノート追記
- [ ] **`code-review` スキルで12視点レビュー実施（PASS確認）**
- [ ] git add && git commit && git push
- [ ] ZIP作成（バージョン名含む）
- [ ] WISHLIST.md の完了項目を更新（該当があれば）

## 関連スキル

| スキル | 用途 | 呼び出し |
|--------|------|----------|
| code-review | 12視点マトリックスレビュー | プッシュ前に必須 |
| wishlist | 完了した機能要望の管理 | 該当があれば更新 |

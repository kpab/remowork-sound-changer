---
name: project-init
description: |
  新規Chrome拡張機能プロジェクトの作成手順。
  ディレクトリ構造、必須ファイル、CLAUDE.md設定を行う。
  発動キーワード: 新規プロジェクト、project init、作成、新しい拡張機能
allowed-tools: Read, Edit, Write, Bash, Glob
version: 1.1.0
updated: 2025-12-27
---

# Project Initialization

## 概要

新規Chrome拡張機能プロジェクトを作成するスキル。
**各プロジェクトは独立したgitリポジトリとして完結する構造で初期化する。**

## 使用タイミング

- 新しいChrome拡張機能を作成する時
- 既存プロジェクトの構造を整理する時

## プロジェクト構造

```
chrome-extension/                    # 親ディレクトリ（テンプレート管理）
├── .claude/
│   └── skills/                      # テンプレートスキル
│       ├── chrome-extension-dev/
│       ├── release/
│       ├── code-review/
│       ├── wishlist/
│       └── project-init/
├── prod/
│   └── [app-name]/                  # 配布用ZIP
└── [app-name]/                      # 個別プロジェクト（独立gitリポジトリ）
    ├── .claude/
    │   └── skills/                  # スキル（コピー済み、リポジトリ内で完結）
    ├── CLAUDE.md
    ├── CHANGELOG.md
    ├── WISHLIST.md
    ├── manifest.json
    └── ...
```

## 新規プロジェクト作成手順

### 1. ディレクトリ作成

```bash
mkdir -p chrome-extension/[app-name]
mkdir -p chrome-extension/prod/[app-name]
cd chrome-extension/[app-name]
git init
```

### 2. スキルをコピー（重要）

**親のスキルを子プロジェクトにコピーして、リポジトリ内で完結させる。**

```bash
mkdir -p .claude/skills
cp -r ../.claude/skills/* .claude/skills/
```

### 3. CLAUDE.md 作成

スキルは**ローカルパス**で参照：

```markdown
# [App Name]

[アプリの説明]

## スキル

| スキル | 用途 | パス |
|-------|------|------|
| chrome-extension-dev | Chrome拡張開発ガイド | `.claude/skills/chrome-extension-dev/SKILL.md` |
| release | リリース手順 | `.claude/skills/release/SKILL.md` |
| code-review | 12視点マトリックスレビュー | `.claude/skills/code-review/SKILL.md` |
| wishlist | ウィッシュリスト管理 | `.claude/skills/wishlist/SKILL.md` |

## 関連ドキュメント

| ドキュメント | 内容 |
|-------------|------|
| CHANGELOG.md | リリースノート |
| WISHLIST.md | 機能要望・改善案リスト |

## 概要

[プロジェクト固有の情報]
```

### 4. CHANGELOG.md 作成

```markdown
# Changelog

[App Name] のリリースノート

## v1.0.0 - 初回リリース
- 初期機能の実装
```

### 5. WISHLIST.md 作成

```markdown
# Wishlist

[App Name] の機能要望・改善案リスト

## 優先度: 高

（なし）

## 優先度: 中

（なし）

## 優先度: 低

（なし）

## 完了済み

（なし）
```

### 6. manifest.json 作成

```json
{
  "manifest_version": 3,
  "name": "[App Name]",
  "version": "1.0.0",
  "description": "[説明]",
  "permissions": [],
  "host_permissions": [],
  "background": {
    "service_worker": "background.js"
  },
  "action": {
    "default_popup": "popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  }
}
```

### 7. 初回コミット

```bash
git add -A
git commit -m "feat: 初期プロジェクト構造を作成"
```

## スキル一覧

| スキル | 用途 |
|--------|------|
| chrome-extension-dev | Chrome拡張開発のベストプラクティス |
| release | リリース・デプロイ手順（code-reviewを呼び出す） |
| code-review | 12視点マトリックスレビュー |
| wishlist | 機能要望の管理 |
| project-init | 新規プロジェクト作成（このスキル） |

## 重要ポイント

1. **スキルは子にコピー** - 各リポジトリで完結させる（クローン可能）
2. **親はテンプレート** - 新規作成時のコピー元として機能
3. **CHANGELOG.md / WISHLIST.md は子に配置** - プロジェクト固有の情報
4. **prod/ にZIPを保存** - バージョン番号を含むファイル名
5. **git push前にcode-reviewスキルを実行** - releaseスキル参照

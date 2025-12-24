# ハンドサイン検出機能 設計書

## 概要

Remoworkの5分ごとの在席確認スナップショットを活用し、ハンドサインでコミュニケーションを可能にする機能。

## ユースケース

```
Aさんが👋のサインで撮影
    ↓
Bさんの画面に「Aさんが話したそうにしています👋」と通知
```

## 技術調査

### Remowork の DOM 構造

```html
<div class="user-picture-container login-user size-large">
  <div class="v-image v-responsive theme--light">
    <div class="v-image__image v-image__image--cover"
         style="background-image: url('https://stage.remowork.biz/api/portrait/...');">
    </div>
  </div>
  <div class="user-name">
    <span class="v-badge...">...</span>
    松川 幸平
  </div>
  <div class="badge">🏆️🐦️ Sp.2</div>
</div>
```

### 画像取得方法

- `background-image: url(...)` から画像URLを抽出
- 5分ごとにURLのタイムスタンプが変わる（`?1766568264` など）
- MutationObserver または定期ポーリングで変更を検知

## 設計

### 追加ファイル

```
remowork-sound-changer/
├── hand-sign-detector.js    # ハンドサイン検出ロジック（Content Script）
└── lib/
    └── mediapipe/           # MediaPipe Hands ライブラリ
```

### popup.html 変更

タブUIを追加:
```
[🔊 音声設定] [👋 ハンドサイン]
```

### 設定データ構造

```javascript
{
  handSign: {
    enabled: true,
    myName: "松川 幸平",        // 自分の名前（除外用）
    detectAll: false,           // 全員検出するか
    targetMembers: [            // 検出対象メンバー
      "田上 豪",
      "松若友加里"
    ],
    notifications: {
      toast: true,              // 画面トースト
      sound: false,             // 通知音
      soundPreset: "doorchime"  // 使う音声（Sound Changerと共有）
    }
  }
}
```

### 検出するハンドサイン

| サイン | ジェスチャー | 意味 |
|--------|-------------|------|
| 👋 | 手を開いて振る | 話したい・声かけて |
| 👍 | サムズアップ | いいね・順調 |
| ✋ | 手を上げる | 質問・手伝って |
| 🙏 | 合掌 | お願い・助けて |

### 検出ロジック

```javascript
// MediaPipe Hands で手のランドマーク（21点）を取得
// ランドマークの位置関係からジェスチャーを判定

function detectGesture(landmarks) {
  // 指が伸びているか判定
  const fingersExtended = checkFingersExtended(landmarks);

  // 👋: 5本指すべて伸びている
  if (fingersExtended.every(f => f)) {
    return 'wave';
  }

  // 👍: 親指のみ伸びている
  if (fingersExtended[0] && !fingersExtended.slice(1).some(f => f)) {
    return 'thumbsup';
  }

  return null;
}
```

## 実装フェーズ

### Phase 1 (MVP)

1. Content Scriptで画像URL変更を監視
2. MediaPipe Handsで手を検出
3. 👋（手を開いている）のみ検出
4. トースト通知を表示

### Phase 2 (設定UI)

1. popup.htmlにタブUI追加
2. 自分の名前入力欄
3. 検出対象メンバーのチェックボックス
4. 通知オプション（トースト/音声）

### Phase 3 (拡張)

1. 複数ジェスチャー対応
2. Chrome通知対応
3. 履歴機能

## パフォーマンス考慮

- 画像解析は5分に1回のみ（URL変更時）
- MediaPipeはWebGL使用で軽量
- 検出対象を絞ることで処理を削減

## 必要な権限

manifest.json への追加は不要（既存の権限で対応可能）

## 参考リンク

- [MediaPipe Hands](https://developers.google.com/mediapipe/solutions/vision/hand_landmarker)
- [TensorFlow.js Hand Pose Detection](https://github.com/tensorflow/tfjs-models/tree/master/hand-pose-detection)

## 作成日

2024-12-24

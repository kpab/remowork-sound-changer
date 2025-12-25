# ハンドサイン検出の仕組み

このドキュメントでは、Remowork Sound Changerで使用しているハンドサイン検出の技術的な仕組みを解説します。

## 概要

本拡張機能では **MediaPipe Hand Landmarker** を使用して、Webカメラ画像から手のランドマーク（特徴点）を検出し、ジェスチャーを判定しています。

## 技術スタック

| コンポーネント | 説明 |
|--------------|------|
| MediaPipe Tasks Vision | Googleが開発した機械学習ライブラリ |
| Hand Landmarker | 手の21個のランドマークを検出するモデル |
| WASM | ブラウザで高速に動作するためのWebAssembly |
| Offscreen Document | Chrome拡張のバックグラウンド処理用ドキュメント |

## ファイル構成

```
remowork-sound-changer/
├── offscreen.html          # Offscreen Document HTML
├── offscreen.js            # 検出ロジック（MediaPipe使用）
├── hand-sign-detector.js   # メンバー画像の監視・検出トリガー
├── lib/mediapipe/
│   ├── vision_bundle.js    # MediaPipe Vision ライブラリ
│   ├── hand_landmarker.task # 学習済みモデル
│   └── *.wasm              # WebAssemblyファイル
```

## 処理フロー

```
[Remowork ページ]
    │
    ▼ 5秒ごとにメンバー画像を取得
[hand-sign-detector.js]
    │
    ▼ ImageDataをメッセージで送信
[background.js]
    │
    ▼ Offscreen Documentに転送
[offscreen.js]
    │
    ▼ MediaPipe Hand Landmarkerで検出
[detectGesture()]
    │
    ▼ ジェスチャー判定結果を返却
[hand-sign-detector.js]
    │
    ▼ 通知を表示
[ユーザーへ通知]
```

## MediaPipe Hand Landmarks

手のランドマークは21点で構成されています：

```
         8   12  16  20   (指先: TIP)
         |   |   |   |
         7   11  15  19   (DIP)
         |   |   |   |
         6   10  14  18   (PIP)
         |   |   |   |
    4    5   9   13  17   (MCP / 指の付け根)
    |    \___|___|___|/
    3        |
    |        |
    2        |
    |        |
    1--------0  (WRIST / 手首)
```

| インデックス | 部位 |
|-------------|------|
| 0 | WRIST（手首） |
| 1-4 | THUMB（親指: CMC, MCP, IP, TIP） |
| 5-8 | INDEX（人差し指: MCP, PIP, DIP, TIP） |
| 9-12 | MIDDLE（中指: MCP, PIP, DIP, TIP） |
| 13-16 | RING（薬指: MCP, PIP, DIP, TIP） |
| 17-20 | PINKY（小指: MCP, PIP, DIP, TIP） |

## 検出可能なジェスチャー

| ジェスチャー | 絵文字 | メッセージ | 検出方法 |
|-------------|-------|-----------|---------|
| Open Palm | 👋 | お話ししたいです！！！ | 片手 |
| Thumbs Up | 👍 | いつでもお話しいいですよ！！ | 片手 |
| Peace | ✌️ | 調子いいから聞いて聞いて！！！ | 片手 |
| Head in Hands | 😢 | 調子悪いので慰めて。。。；； | 両手 |

---

### 1. Open Palm（手のひら/手を振る）👋

**意味**: 「お話ししたいです！！！」

**検出パターン** (3種類):

#### パターンA: 4本指が伸びている
最も一般的な「パー」の形。
- 人差し指〜小指の全てが伸びている（TIPがPIPより上）

```javascript
const fourFingersOpen = indexExtended && middleExtended && ringExtended && pinkyExtended;
```

#### パターンB: 指が揃っている（閉じた手のひら）
指を閉じて手を広げている形。
- 隣接する指先の距離が近い（手のひら幅の25%以下）
- 指がある程度伸びている（MCPからTIPまでの距離が手のひら幅の40%以上）

```javascript
const fingersAligned = avgFingerTipDist < palmWidth * 0.25;
const fingersLongEnough = avgFingerLength > palmWidth * 0.4;
```

#### パターンC: 3本以上の指が伸びている
一部の指が曲がっていても検出。
- 少なくとも3本の指が伸びている
- 指がある程度の長さがある

```javascript
const extendedCount = [...].filter(Boolean).length;
if (extendedCount >= 3 && fingersLongEnough) { ... }
```

---

### 2. Thumbs Up（サムズアップ）👍

**意味**: 「いつでもお話しいいですよ！！」

**判定条件**:
- 親指が上を向いている（TIPのY座標がMCPより上）
- 親指が伸びている（TIPがIPより外側）
- 他の4本指が閉じている（各TIPがPIPより下）

```javascript
if (thumbUp && thumbExtended && fourFingersClosed) {
  return { type: 'thumbs_up', emoji: '👍' };
}
```

---

### 3. Peace（ピースサイン）✌️

**意味**: 「調子いいから聞いて聞いて！！！」

**判定条件**:
- 人差し指と中指が伸びている
- 薬指と小指が閉じている

```javascript
const peaceSign = indexExtended && middleExtended && !ringExtended && !pinkyExtended;
if (peaceSign) {
  return { type: 'peace', emoji: '✌️' };
}
```

---

### 4. Head in Hands（頭を抱える）😢 【両手ジェスチャー】

**意味**: 「調子悪いので慰めて。。。；；」

**判定条件**:
- 両手が検出されている（MediaPipeは最大2手を検出）
- 両手首が画像の上部にある（顔の近く、Y座標が0.5未満）
- 両手首が左右に離れている（X座標の差が0.3以上）
- 左手は画像の左側、右手は画像の右側にある

```javascript
function detectHeadInHands(landmarks1, landmarks2) {
  const wrist1 = landmarks1[0];
  const wrist2 = landmarks2[0];

  const bothHandsHigh = wrist1.y < 0.5 && wrist2.y < 0.5;
  const handsSpread = Math.abs(wrist1.x - wrist2.x) > 0.3;
  // ...
}
```

**ポイント**: このジェスチャーは「ネガティブ」フラグが設定されており、留守モードのランダム送信からは除外されます。

## 誤検出防止機能

### 1. 自分が離席中は検出スキップ

Remoworkで離席ステータスになっている場合、検出を一時停止します。
これにより、離席中に表示される事前撮影画像での誤検出を防ぎます。

```javascript
// hand-sign-detector.js
if (isRemoworkAway()) {
  return; // スキャンをスキップ
}
```

### 2. 相手が離席中は検出対象から除外

離席アイコン（`.mdi-account-remove`）が表示されているメンバーは検出対象から除外します。

```javascript
// hand-sign-detector.js
const awayIcon = container.querySelector('.mdi-account-remove');
if (awayIcon) {
  return; // このメンバーをスキップ
}
```

## GPU / CPU フォールバック

MediaPipe Hand Landmarkerは、可能であればGPU（WebGL）を使用して高速に処理します。GPUが利用できない環境では、自動的にCPUにフォールバックします。

```javascript
try {
  handLandmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: { delegate: 'GPU' },
    // ...
  });
} catch (gpuError) {
  // GPU失敗時はCPUにフォールバック
  handLandmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: { delegate: 'CPU' },
    // ...
  });
}
```

## パフォーマンス考慮

| 項目 | 設定値 | 説明 |
|------|-------|------|
| スキャン間隔 | 5秒 | メンバー画像の取得間隔 |
| 検出対象 | 最大2手 | 1フレームで検出する手の数 |
| モデルサイズ | 約10MB | hand_landmarker.task |

## トラブルシューティング

### 検出されない場合

1. **手が画像内に収まっているか確認**
   - 手全体（手首から指先まで）が見えている必要があります

2. **照明が十分か確認**
   - 暗い環境では検出精度が低下します

3. **手の角度を調整**
   - 手のひらを正面に向けると検出されやすくなります

### 誤検出が多い場合

1. **背景を整理**
   - 手に似た形状のオブジェクトを避ける

2. **離席ステータスを活用**
   - 離席中は自動で検出がスキップされます

## 参考リンク

- [MediaPipe Hand Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker)
- [MediaPipe Tasks for Web](https://ai.google.dev/edge/mediapipe/solutions/setup_web)

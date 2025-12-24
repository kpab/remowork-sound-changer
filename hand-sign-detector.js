/**
 * Remowork Hand Sign Detector
 * 在席確認画像からハンドサインを検出し、通知を表示する
 */

(function() {
  'use strict';

  const DETECTION_INTERVAL = 10000; // 10秒ごとにチェック（画像URL変更検知用）
  const NOTIFICATION_COOLDOWN = 300000; // 同じ人からの通知は5分間抑制

  // 検出済みの画像URLを記録（重複検出防止）
  const processedImages = new Map();
  // 通知クールダウン管理
  const notificationCooldowns = new Map();

  // 設定（デフォルト値）
  let settings = {
    enabled: true,
    myName: '',
    detectAll: true,
    targetMembers: [],
    notifications: {
      toast: true,
      sound: true,
      soundPreset: 'doorchime'
    }
  };

  // MediaPipe Hands 関連
  let handsDetector = null;
  let isMediaPipeLoaded = false;

  /**
   * 設定を読み込む
   */
  async function loadSettings() {
    try {
      const result = await chrome.storage.local.get('handSignSettings');
      if (result.handSignSettings) {
        settings = { ...settings, ...result.handSignSettings };
      }
      console.log('[HandSign] Settings loaded:', settings);
    } catch (error) {
      console.error('[HandSign] Failed to load settings:', error);
    }
  }

  /**
   * 自分の名前をページから自動検出
   */
  function detectMyName() {
    // login-user クラスを持つ要素から自分の名前を取得
    const loginUserElement = document.querySelector('.user-picture-container.login-user .user-name');
    if (loginUserElement) {
      const name = loginUserElement.textContent.trim();
      if (name && !settings.myName) {
        settings.myName = name;
        console.log('[HandSign] Detected my name:', name);
        // 設定を保存
        chrome.storage.local.set({ handSignSettings: settings });
      }
    }
  }

  /**
   * オンラインメンバーの画像情報を取得
   */
  function getOnlineMembers() {
    const members = [];
    const containers = document.querySelectorAll('.user-picture-container:not(.login-user)');

    containers.forEach(container => {
      const nameElement = container.querySelector('.user-name');
      const imageElement = container.querySelector('.v-image__image');

      if (nameElement && imageElement) {
        const name = nameElement.textContent.trim();
        const style = imageElement.getAttribute('style') || '';
        const match = style.match(/background-image:\s*url\(["']?([^"')]+)["']?\)/);

        if (match && match[1]) {
          members.push({
            name: name,
            imageUrl: match[1],
            element: container
          });
        }
      }
    });

    return members;
  }

  /**
   * 画像を読み込んでCanvas化
   */
  async function loadImageToCanvas(imageUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        resolve(canvas);
      };
      img.onerror = reject;
      img.src = imageUrl;
    });
  }

  /**
   * MediaPipe Hands を初期化
   */
  async function initMediaPipe() {
    if (isMediaPipeLoaded) return true;

    try {
      // MediaPipe Vision Tasks をインポート
      const vision = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/+esm');

      const { HandLandmarker, FilesetResolver } = vision;

      const filesetResolver = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm'
      );

      handsDetector = await HandLandmarker.createFromOptions(filesetResolver, {
        baseOptions: {
          modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
          delegate: 'GPU'
        },
        runningMode: 'IMAGE',
        numHands: 2
      });

      isMediaPipeLoaded = true;
      console.log('[HandSign] MediaPipe Hands initialized');
      return true;
    } catch (error) {
      console.error('[HandSign] Failed to initialize MediaPipe:', error);
      return false;
    }
  }

  /**
   * 手のランドマークからジェスチャーを判定
   * MediaPipe Hands の21点のランドマークを使用
   */
  function detectGesture(landmarks) {
    if (!landmarks || landmarks.length === 0) return null;

    // 各指のランドマークインデックス
    // 0: 手首, 1-4: 親指, 5-8: 人差し指, 9-12: 中指, 13-16: 薬指, 17-20: 小指
    const FINGER_TIPS = [4, 8, 12, 16, 20];
    const FINGER_PIPS = [3, 6, 10, 14, 18];

    // 指が伸びているかチェック（先端がPIPより上にあるか）
    const fingersExtended = [];

    // 親指（横方向で判定）
    const thumbExtended = landmarks[4].x < landmarks[3].x; // 右手の場合
    fingersExtended.push(thumbExtended);

    // 他の4本の指（縦方向で判定）
    for (let i = 1; i < 5; i++) {
      const tipY = landmarks[FINGER_TIPS[i]].y;
      const pipY = landmarks[FINGER_PIPS[i]].y;
      fingersExtended.push(tipY < pipY);
    }

    // 👋 手を振る: 5本指すべて伸びている
    if (fingersExtended.every(f => f)) {
      return { type: 'wave', emoji: '👋', message: '話したそうにしています' };
    }

    // 👍 サムズアップ: 親指のみ伸びている
    if (fingersExtended[0] && !fingersExtended[1] && !fingersExtended[2] && !fingersExtended[3] && !fingersExtended[4]) {
      return { type: 'thumbsup', emoji: '👍', message: 'いいね！しています' };
    }

    // ✋ 挙手: 手のひらを見せている（5本指伸びていて手が上にある）
    const handY = landmarks[0].y;
    if (fingersExtended.every(f => f) && handY < 0.5) {
      return { type: 'raise', emoji: '✋', message: '質問があります' };
    }

    return null;
  }

  /**
   * 簡易的なジェスチャー検出（MediaPipeが使えない場合のフォールバック）
   * 画像の特定エリアの色分布から手の存在を推測
   */
  async function detectGestureSimple(canvas) {
    // この実装は仮のもの
    // 実際にはMediaPipeを使うべきだが、CDN制限がある場合のフォールバック
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    // 肌色の割合を計算（簡易的な手の検出）
    let skinPixels = 0;
    const totalPixels = imageData.data.length / 4;

    for (let i = 0; i < imageData.data.length; i += 4) {
      const r = imageData.data[i];
      const g = imageData.data[i + 1];
      const b = imageData.data[i + 2];

      // 肌色の範囲（簡易的）
      if (r > 95 && g > 40 && b > 20 && r > g && r > b && Math.abs(r - g) > 15) {
        skinPixels++;
      }
    }

    const skinRatio = skinPixels / totalPixels;

    // 肌色が多い場合（20%以上）、手を挙げている可能性
    if (skinRatio > 0.20) {
      // ランダムで👋か👍を返す（実際の検出ができないため）
      // 本番ではMediaPipeを使用すべき
      return null; // 簡易検出は無効化
    }

    return null;
  }

  /**
   * 画像からハンドサインを検出
   */
  async function detectHandSign(member) {
    try {
      const canvas = await loadImageToCanvas(member.imageUrl);

      let gesture = null;

      if (handsDetector) {
        // MediaPipe を使用
        const results = handsDetector.detect(canvas);
        if (results.landmarks && results.landmarks.length > 0) {
          gesture = detectGesture(results.landmarks[0]);
        }
      } else {
        // フォールバック（簡易検出）
        gesture = await detectGestureSimple(canvas);
      }

      return gesture;
    } catch (error) {
      console.error('[HandSign] Detection error for', member.name, error);
      return null;
    }
  }

  /**
   * トースト通知を表示
   */
  function showToast(name, gesture) {
    const toast = document.createElement('div');
    toast.className = 'rsc-hand-sign-toast';
    toast.innerHTML = `
      <div class="rsc-hand-sign-toast-content">
        <span class="rsc-hand-sign-emoji">${gesture.emoji}</span>
        <span class="rsc-hand-sign-text"><strong>${name}</strong>さんが${gesture.message}</span>
      </div>
    `;

    // スタイルを追加
    toast.style.cssText = `
      position: fixed;
      top: 80px;
      right: 20px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 16px 24px;
      border-radius: 12px;
      z-index: 100001;
      font-size: 16px;
      box-shadow: 0 8px 32px rgba(102, 126, 234, 0.4);
      animation: rsc-hand-sign-slide-in 0.5s ease-out;
      display: flex;
      align-items: center;
      gap: 12px;
    `;

    document.body.appendChild(toast);

    // アニメーション用のスタイルを追加
    if (!document.getElementById('rsc-hand-sign-styles')) {
      const style = document.createElement('style');
      style.id = 'rsc-hand-sign-styles';
      style.textContent = `
        @keyframes rsc-hand-sign-slide-in {
          from {
            transform: translateX(100%);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
        @keyframes rsc-hand-sign-slide-out {
          from {
            transform: translateX(0);
            opacity: 1;
          }
          to {
            transform: translateX(100%);
            opacity: 0;
          }
        }
        .rsc-hand-sign-toast-content {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .rsc-hand-sign-emoji {
          font-size: 32px;
        }
      `;
      document.head.appendChild(style);
    }

    // 5秒後に消える
    setTimeout(() => {
      toast.style.animation = 'rsc-hand-sign-slide-out 0.5s ease-in forwards';
      setTimeout(() => toast.remove(), 500);
    }, 5000);
  }

  /**
   * 通知音を再生
   */
  async function playNotificationSound() {
    if (!settings.notifications.sound) return;

    try {
      // background.js に通知音再生を依頼
      chrome.runtime.sendMessage({
        type: 'PLAY_HAND_SIGN_SOUND',
        preset: settings.notifications.soundPreset
      });
    } catch (error) {
      console.error('[HandSign] Failed to play sound:', error);
    }
  }

  /**
   * 通知を表示
   */
  function notify(member, gesture) {
    // クールダウンチェック
    const lastNotification = notificationCooldowns.get(member.name);
    if (lastNotification && Date.now() - lastNotification < NOTIFICATION_COOLDOWN) {
      return;
    }

    console.log('[HandSign] Detected:', member.name, gesture);

    // トースト表示
    if (settings.notifications.toast) {
      showToast(member.name, gesture);
    }

    // 通知音再生
    if (settings.notifications.sound) {
      playNotificationSound();
    }

    // クールダウン記録
    notificationCooldowns.set(member.name, Date.now());
  }

  /**
   * メンバーの画像をスキャン
   */
  async function scanMembers() {
    if (!settings.enabled) return;

    const members = getOnlineMembers();

    for (const member of members) {
      // 自分は除外
      if (member.name === settings.myName) continue;

      // 検出対象でない場合は除外
      if (!settings.detectAll && !settings.targetMembers.includes(member.name)) continue;

      // 既に処理済みの画像は除外
      if (processedImages.get(member.name) === member.imageUrl) continue;

      // 画像を記録
      processedImages.set(member.name, member.imageUrl);

      // ハンドサイン検出
      const gesture = await detectHandSign(member);
      if (gesture) {
        notify(member, gesture);
      }
    }
  }

  /**
   * 初期化
   */
  async function init() {
    console.log('[HandSign] Initializing...');

    // 設定を読み込む
    await loadSettings();

    // 自分の名前を検出
    detectMyName();

    // MediaPipe を初期化（バックグラウンドで）
    initMediaPipe().catch(console.error);

    // 定期スキャン開始
    setInterval(scanMembers, DETECTION_INTERVAL);

    // 初回スキャン
    setTimeout(scanMembers, 3000);

    console.log('[HandSign] Initialized');
  }

  // 設定変更を監視
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.handSignSettings) {
      settings = { ...settings, ...changes.handSignSettings.newValue };
      console.log('[HandSign] Settings updated:', settings);
    }
  });

  // 通知音再生のメッセージを受信
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'PLAY_NOTIFICATION_SOUND' && message.url) {
      const audio = new Audio(message.url);
      audio.volume = 0.7;
      audio.play().catch(console.error);
      sendResponse({ success: true });
    }
    return true;
  });

  // ページ読み込み完了後に初期化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

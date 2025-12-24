/**
 * Remowork Hand Sign Detector
 * 在席確認画像からハンドサインを検出し、通知を表示する
 */

(function() {
  'use strict';

  const DETECTION_INTERVAL = 10000; // 10秒ごとにチェック（画像URL変更検知用）
  const NOTIFICATION_COOLDOWN = 300000; // 同じ人からの通知は5分間抑制
  const PHOTO_INTERVAL = 300; // 写真撮影間隔（5分 = 300秒）

  // 検出済みの画像URLを記録（重複検出防止）
  const processedImages = new Map();
  // 通知クールダウン管理
  const notificationCooldowns = new Map();
  // タイマー関連
  let timerElement = null;
  let remainingSeconds = PHOTO_INTERVAL;
  let lastMyImageUrl = null;
  let timerInterval = null;

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
   * 自分の画像URLを取得
   */
  function getMyImageUrl() {
    const loginUserContainer = document.querySelector('.user-picture-container.login-user');
    if (loginUserContainer) {
      const imageElement = loginUserContainer.querySelector('.v-image__image');
      if (imageElement) {
        const style = imageElement.getAttribute('style') || '';
        const match = style.match(/background-image:\s*url\(["']?([^"')]+)["']?\)/);
        if (match && match[1]) {
          return match[1];
        }
      }
    }
    return null;
  }

  /**
   * タイマーUIを作成
   */
  function createTimerUI() {
    if (timerElement) return;

    timerElement = document.createElement('div');
    timerElement.id = 'rsc-photo-timer';
    timerElement.innerHTML = `
      <div class="rsc-timer-icon">📷</div>
      <div class="rsc-timer-text">
        <span class="rsc-timer-label">次の撮影まで</span>
        <span class="rsc-timer-value">5:00</span>
      </div>
      <div class="rsc-timer-buttons">
        <button class="rsc-send-btn" data-type="wave" title="👋を送信">👋</button>
        <button class="rsc-send-btn" data-type="thumbsup" title="👍を送信">👍</button>
      </div>
    `;

    document.body.appendChild(timerElement);

    // スタイルを追加
    if (!document.getElementById('rsc-timer-styles')) {
      const style = document.createElement('style');
      style.id = 'rsc-timer-styles';
      style.textContent = `
        #rsc-photo-timer {
          position: fixed;
          bottom: 20px;
          left: 20px;
          background: linear-gradient(135deg, #2d3748 0%, #1a202c 100%);
          color: white;
          padding: 10px 16px;
          border-radius: 10px;
          z-index: 100000;
          font-size: 14px;
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
          display: flex;
          align-items: center;
          gap: 10px;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          opacity: 0.9;
          transition: opacity 0.2s, box-shadow 0.2s;
          cursor: move;
          user-select: none;
        }
        #rsc-photo-timer:hover {
          opacity: 1;
        }
        #rsc-photo-timer.rsc-dragging {
          opacity: 1;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
        }
        #rsc-photo-timer.rsc-timer-hidden {
          display: none;
        }
        .rsc-timer-icon {
          font-size: 20px;
        }
        .rsc-timer-text {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .rsc-timer-label {
          font-size: 11px;
          color: #a0aec0;
        }
        .rsc-timer-value {
          font-size: 18px;
          font-weight: 600;
          font-variant-numeric: tabular-nums;
        }
        #rsc-photo-timer.rsc-timer-soon .rsc-timer-value {
          color: #fc8181;
        }
        #rsc-photo-timer.rsc-timer-flash {
          animation: rsc-timer-flash 0.5s ease-out;
        }
        @keyframes rsc-timer-flash {
          0% { background: linear-gradient(135deg, #48bb78 0%, #38a169 100%); }
          100% { background: linear-gradient(135deg, #2d3748 0%, #1a202c 100%); }
        }
        .rsc-timer-buttons {
          display: flex;
          gap: 6px;
          margin-left: 8px;
          padding-left: 12px;
          border-left: 1px solid rgba(255,255,255,0.2);
        }
        .rsc-send-btn {
          width: 32px;
          height: 32px;
          border: none;
          border-radius: 6px;
          background: rgba(255,255,255,0.15);
          font-size: 16px;
          cursor: pointer;
          transition: all 0.2s;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .rsc-send-btn:hover {
          background: rgba(255,255,255,0.25);
          transform: scale(1.1);
        }
        .rsc-send-btn:active {
          transform: scale(0.95);
        }
        .rsc-send-btn.rsc-active {
          background: linear-gradient(135deg, #48bb78 0%, #38a169 100%);
          box-shadow: 0 0 8px rgba(72, 187, 120, 0.5);
        }
        .rsc-send-btn:disabled {
          opacity: 0.3;
          cursor: not-allowed;
        }
      `;
      document.head.appendChild(style);
    }

    // ボタンのクリックハンドラー
    setupSendButtons();

    // ドラッグ機能
    setupDraggable();
  }

  // ドラッグ関連の変数
  let isDragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let timerStartX = 0;
  let timerStartY = 0;

  /**
   * ドラッグ機能のセットアップ
   */
  function setupDraggable() {
    if (!timerElement) return;

    // 保存された位置を復元
    chrome.storage.local.get(['timerPosition'], (result) => {
      if (result.timerPosition) {
        timerElement.style.left = result.timerPosition.left;
        timerElement.style.top = result.timerPosition.top;
        timerElement.style.bottom = 'auto';
        timerElement.style.right = 'auto';
      }
    });

    timerElement.addEventListener('mousedown', onDragStart);
    timerElement.addEventListener('touchstart', onDragStart, { passive: false });
  }

  /**
   * ドラッグ開始
   */
  function onDragStart(e) {
    // ボタンクリックは除外
    if (e.target.closest('.rsc-send-btn')) return;

    isDragging = true;
    timerElement.classList.add('rsc-dragging');

    const rect = timerElement.getBoundingClientRect();
    timerStartX = rect.left;
    timerStartY = rect.top;

    if (e.type === 'touchstart') {
      dragStartX = e.touches[0].clientX;
      dragStartY = e.touches[0].clientY;
      e.preventDefault();
    } else {
      dragStartX = e.clientX;
      dragStartY = e.clientY;
    }

    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup', onDragEnd);
    document.addEventListener('touchmove', onDragMove, { passive: false });
    document.addEventListener('touchend', onDragEnd);
  }

  /**
   * ドラッグ中
   */
  function onDragMove(e) {
    if (!isDragging) return;

    let clientX, clientY;
    if (e.type === 'touchmove') {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
      e.preventDefault();
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    const deltaX = clientX - dragStartX;
    const deltaY = clientY - dragStartY;

    let newX = timerStartX + deltaX;
    let newY = timerStartY + deltaY;

    // 画面外に出ないように制限
    const rect = timerElement.getBoundingClientRect();
    const maxX = window.innerWidth - rect.width;
    const maxY = window.innerHeight - rect.height;

    newX = Math.max(0, Math.min(newX, maxX));
    newY = Math.max(0, Math.min(newY, maxY));

    timerElement.style.left = newX + 'px';
    timerElement.style.top = newY + 'px';
    timerElement.style.bottom = 'auto';
    timerElement.style.right = 'auto';
  }

  /**
   * ドラッグ終了
   */
  function onDragEnd() {
    if (!isDragging) return;

    isDragging = false;
    timerElement.classList.remove('rsc-dragging');

    document.removeEventListener('mousemove', onDragMove);
    document.removeEventListener('mouseup', onDragEnd);
    document.removeEventListener('touchmove', onDragMove);
    document.removeEventListener('touchend', onDragEnd);

    // 位置を保存
    chrome.storage.local.set({
      timerPosition: {
        left: timerElement.style.left,
        top: timerElement.style.top
      }
    });
  }

  // 現在有効なハンドサインタイプ
  let activeHandSignType = null;

  /**
   * 送信ボタンのセットアップ
   */
  function setupSendButtons() {
    const buttons = timerElement.querySelectorAll('.rsc-send-btn');
    buttons.forEach(btn => {
      btn.addEventListener('click', () => {
        const type = btn.dataset.type;
        toggleHandSignSend(type, btn);
      });
    });
  }

  /**
   * ハンドサイン送信をトグル
   */
  async function toggleHandSignSend(type, btn) {
    // 画像が登録されているかチェック（配列形式）
    const images = await getVirtualCameraImages();
    const imageArray = images?.[type];
    if (!imageArray || !Array.isArray(imageArray) || imageArray.length === 0) {
      showTimerToast('画像が未登録です。設定画面で撮影してください。');
      return;
    }

    if (activeHandSignType === type) {
      // 無効化
      activeHandSignType = null;
      btn.classList.remove('rsc-active');
      disableVirtualCamera();
      showTimerToast('通常カメラに戻りました');
    } else {
      // 有効化
      // 他のボタンをリセット
      timerElement.querySelectorAll('.rsc-send-btn').forEach(b => b.classList.remove('rsc-active'));
      activeHandSignType = type;
      btn.classList.add('rsc-active');
      enableVirtualCamera(type);
      const emoji = type === 'wave' ? '👋' : '👍';
      showTimerToast(`${emoji} 次の撮影でランダム送信（${imageArray.length}枚）`);
    }
  }

  /**
   * 仮想カメラ画像をストレージから取得
   */
  async function getVirtualCameraImages() {
    return new Promise(resolve => {
      chrome.storage.local.get(['virtualCameraImages'], result => {
        resolve(result.virtualCameraImages || {});
      });
    });
  }

  /**
   * 仮想カメラを有効化（ページに通知）
   */
  function enableVirtualCamera(type) {
    window.postMessage({
      source: 'remowork-virtual-camera',
      type: 'ENABLE_VIRTUAL_CAMERA',
      payload: { imageType: type }
    }, '*');
  }

  /**
   * 仮想カメラを無効化
   */
  function disableVirtualCamera() {
    window.postMessage({
      source: 'remowork-virtual-camera',
      type: 'DISABLE_VIRTUAL_CAMERA',
      payload: {}
    }, '*');
  }

  /**
   * タイマー横にトースト表示
   */
  function showTimerToast(message) {
    const existing = document.querySelector('.rsc-timer-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'rsc-timer-toast';
    toast.textContent = message;
    toast.style.cssText = `
      position: fixed;
      bottom: 70px;
      left: 20px;
      background: rgba(0,0,0,0.8);
      color: white;
      padding: 8px 16px;
      border-radius: 8px;
      font-size: 13px;
      z-index: 100001;
      animation: rsc-toast-fade 2s ease-out forwards;
    `;

    if (!document.getElementById('rsc-toast-styles')) {
      const style = document.createElement('style');
      style.id = 'rsc-toast-styles';
      style.textContent = `
        @keyframes rsc-toast-fade {
          0% { opacity: 0; transform: translateY(10px); }
          15% { opacity: 1; transform: translateY(0); }
          85% { opacity: 1; }
          100% { opacity: 0; }
        }
      `;
      document.head.appendChild(style);
    }

    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2000);
  }

  /**
   * タイマー表示を更新
   */
  function updateTimerDisplay() {
    if (!timerElement) return;

    const minutes = Math.floor(remainingSeconds / 60);
    const seconds = remainingSeconds % 60;
    const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;

    const valueElement = timerElement.querySelector('.rsc-timer-value');
    if (valueElement) {
      valueElement.textContent = timeStr;
    }

    // 残り30秒以下で色を変える
    if (remainingSeconds <= 30) {
      timerElement.classList.add('rsc-timer-soon');
    } else {
      timerElement.classList.remove('rsc-timer-soon');
    }
  }

  /**
   * タイマーをリセット（写真撮影時）
   */
  function resetTimer() {
    remainingSeconds = PHOTO_INTERVAL;
    updateTimerDisplay();

    // フラッシュアニメーション
    if (timerElement) {
      timerElement.classList.remove('rsc-timer-flash');
      void timerElement.offsetWidth; // リフロー強制
      timerElement.classList.add('rsc-timer-flash');
    }

    // ハンドサイン送信後は自動で通常カメラに戻す
    if (activeHandSignType) {
      const emoji = activeHandSignType === 'wave' ? '👋' : '👍';
      showTimerToast(`${emoji} 送信完了！通常カメラに戻りました`);
      activeHandSignType = null;
      timerElement.querySelectorAll('.rsc-send-btn').forEach(b => b.classList.remove('rsc-active'));
      disableVirtualCamera();
    }

    console.log('[HandSign] Timer reset to 5 minutes');
  }

  /**
   * タイマーを1秒減らす
   */
  function tickTimer() {
    if (remainingSeconds > 0) {
      remainingSeconds--;
      updateTimerDisplay();
    }
  }

  /**
   * 自分の画像URL変更を監視
   */
  function checkMyImageChange() {
    const currentUrl = getMyImageUrl();
    if (currentUrl && lastMyImageUrl && currentUrl !== lastMyImageUrl) {
      // 画像が変わった = 写真が撮られた
      console.log('[HandSign] My image changed, resetting timer');
      resetTimer();
    }
    lastMyImageUrl = currentUrl;
  }

  /**
   * タイマーを開始
   */
  function startTimer() {
    if (timerInterval) return;

    // 初期画像URLを取得
    lastMyImageUrl = getMyImageUrl();

    // 1秒ごとにカウントダウン
    timerInterval = setInterval(() => {
      tickTimer();
      checkMyImageChange();
    }, 1000);

    console.log('[HandSign] Timer started');
  }

  /**
   * タイマーを停止
   */
  function stopTimer() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  /**
   * タイマーの表示/非表示を切り替え
   */
  function updateTimerVisibility() {
    if (!timerElement) return;

    if (settings.enabled) {
      timerElement.classList.remove('rsc-timer-hidden');
    } else {
      timerElement.classList.add('rsc-timer-hidden');
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

    // タイマーUIを作成
    createTimerUI();
    updateTimerDisplay();
    updateTimerVisibility();

    // タイマーを開始
    startTimer();

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
      updateTimerVisibility();
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

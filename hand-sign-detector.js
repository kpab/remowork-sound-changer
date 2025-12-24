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
      soundPreset: 'outgoing:outgoing_horn' // デフォルトは法螺貝
    }
  };

  // オフスクリーンAPI経由でハンド検出
  let isDetectorReady = false;

  /**
   * 拡張機能コンテキストが有効かチェック
   */
  function isExtensionContextValid() {
    try {
      return chrome.runtime && chrome.runtime.id;
    } catch (e) {
      return false;
    }
  }

  /**
   * 設定を読み込む
   */
  async function loadSettings() {
    if (!isExtensionContextValid()) {
      console.warn('[HandSign] Extension context invalidated, please reload the page');
      return;
    }
    try {
      const result = await chrome.storage.local.get('handSignSettings');
      if (result.handSignSettings) {
        settings = { ...settings, ...result.handSignSettings };
      }
      console.log('[HandSign] Settings loaded:', settings);
    } catch (error) {
      if (error.message.includes('Extension context invalidated')) {
        console.warn('[HandSign] Extension was updated, please reload the page');
      } else {
        console.error('[HandSign] Failed to load settings:', error);
      }
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
      <div class="rsc-timer-main">
        <div class="rsc-timer-icon">📷</div>
        <div class="rsc-timer-text">
          <span class="rsc-timer-label">次の撮影まで</span>
          <span class="rsc-timer-value">5:00</span>
        </div>
      </div>
      <div class="rsc-timer-divider"></div>
      <div class="rsc-timer-buttons">
        <button class="rsc-send-btn" data-type="wave" title="👋を次回送信">👋</button>
        <button class="rsc-send-btn" data-type="thumbsup" title="👍を次回送信">👍</button>
        <button class="rsc-away-btn" title="留守モード（30分間自動送信）">🏃 留守</button>
      </div>
      <div class="rsc-timer-divider"></div>
      <button class="rsc-tools-btn" title="事前撮影">📸 事前撮影</button>
      <button class="rsc-record-btn" title="録音">🎙️</button>
      <button class="rsc-test-btn" title="通知テスト">🔔</button>
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
          user-select: none;
        }
        #rsc-photo-timer:hover {
          opacity: 1;
        }
        .rsc-timer-main {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .rsc-timer-divider {
          width: 1px;
          height: 28px;
          background: rgba(255,255,255,0.2);
        }
        .rsc-tools-btn {
          padding: 6px 12px;
          border: none;
          border-radius: 6px;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: #fff;
          font-size: 13px;
          cursor: pointer;
          transition: all 0.2s;
          white-space: nowrap;
        }
        .rsc-tools-btn:hover {
          transform: scale(1.05);
          box-shadow: 0 2px 8px rgba(102, 126, 234, 0.4);
        }
        .rsc-away-btn {
          padding: 6px 10px;
          border: none;
          border-radius: 6px;
          background: rgba(255,255,255,0.15);
          color: #fff;
          font-size: 13px;
          cursor: pointer;
          transition: all 0.2s;
          white-space: nowrap;
        }
        .rsc-away-btn:hover {
          background: rgba(255,255,255,0.25);
          transform: scale(1.05);
        }
        .rsc-away-btn.rsc-active {
          background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
          box-shadow: 0 0 8px rgba(245, 158, 11, 0.5);
          animation: rsc-away-pulse 2s infinite;
        }
        @keyframes rsc-away-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
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
        .rsc-record-btn {
          width: 32px;
          height: 32px;
          border: none;
          border-radius: 6px;
          background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
          font-size: 16px;
          cursor: pointer;
          transition: all 0.2s;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .rsc-record-btn:hover {
          background: linear-gradient(135deg, #f87171 0%, #ef4444 100%);
          transform: scale(1.1);
        }
        .rsc-test-btn {
          width: 32px;
          height: 32px;
          border: none;
          border-radius: 6px;
          background: linear-gradient(135deg, #ed8936 0%, #dd6b20 100%);
          font-size: 16px;
          cursor: pointer;
          transition: all 0.2s;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .rsc-test-btn:hover {
          background: linear-gradient(135deg, #f6ad55 0%, #ed8936 100%);
          transform: scale(1.1);
        }
        .rsc-test-btn:active {
          transform: scale(0.95);
        }
      `;
      document.head.appendChild(style);
    }

    // ボタンのクリックハンドラー
    setupSendButtons();

    // テストボタンのハンドラー
    setupTestButton();

    // 事前撮影ボタンのハンドラー
    setupToolsButton();

    // ドラッグ機能
    setupDraggable();
  }

  /**
   * 事前撮影ボタンのクリックハンドラー
   */
  function setupToolsButton() {
    const toolsBtn = timerElement.querySelector('.rsc-tools-btn');
    if (toolsBtn) {
      toolsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openToolsModal('camera');
      });
    }

    // 録音ボタン
    const recordBtn = timerElement.querySelector('.rsc-record-btn');
    if (recordBtn) {
      recordBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openToolsModal('recorder');
      });
    }
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
    if (e.target.closest('.rsc-send-btn') || e.target.closest('.rsc-test-btn') || e.target.closest('.rsc-tools-btn') || e.target.closest('.rsc-away-btn') || e.target.closest('.rsc-record-btn')) return;

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

  // 留守モード関連
  let isAwayMode = false;
  let awayModeTimeout = null;
  let awayModeEndTime = null;
  let awayModeDuration = 30 * 60 * 1000; // デフォルト30分

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

    // 留守モードボタン
    const awayBtn = timerElement.querySelector('.rsc-away-btn');
    if (awayBtn) {
      awayBtn.addEventListener('click', () => toggleAwayMode());
    }
  }

  /**
   * 留守モードをトグル
   */
  async function toggleAwayMode() {
    const awayBtn = timerElement.querySelector('.rsc-away-btn');

    if (isAwayMode) {
      // 留守モードを解除
      stopAwayMode();
      showTimerToast('留守モードを解除しました');
    } else {
      // 画像があるかチェック
      const images = await getVirtualCameraImages();
      const hasWave = images?.wave?.length > 0;
      const hasThumbsup = images?.thumbsup?.length > 0;

      if (!hasWave && !hasThumbsup) {
        showTimerToast('画像が未登録です。事前撮影してください。');
        return;
      }

      // 時間を入力（分単位）
      const inputMinutes = prompt('留守モードの時間を入力（分）', '30');
      if (inputMinutes === null) return; // キャンセル

      const minutes = parseInt(inputMinutes, 10);
      if (isNaN(minutes) || minutes <= 0) {
        showTimerToast('有効な時間を入力してください');
        return;
      }

      awayModeDuration = minutes * 60 * 1000;

      // 留守モードを開始
      startAwayMode();
      showTimerToast(`🏃 留守モード開始（${minutes}分後に自動解除）`);
    }
  }

  /**
   * 留守モードを開始
   */
  function startAwayMode() {
    isAwayMode = true;
    awayModeEndTime = Date.now() + awayModeDuration;

    const awayBtn = timerElement.querySelector('.rsc-away-btn');
    if (awayBtn) {
      awayBtn.classList.add('rsc-active');
      updateAwayButtonText();
    }

    // 他のハンドサインボタンをリセット
    timerElement.querySelectorAll('.rsc-send-btn').forEach(b => b.classList.remove('rsc-active'));
    activeHandSignType = null;

    // 仮想カメラを有効化（waveとthumbsupからランダム）
    enableVirtualCameraRandom();

    // 指定時間後に自動解除
    awayModeTimeout = setTimeout(() => {
      stopAwayMode();
      showTimerToast('留守モードが終了しました');
    }, awayModeDuration);

    // 残り時間を更新
    updateAwayTimeInterval = setInterval(updateAwayButtonText, 1000);
  }

  let updateAwayTimeInterval = null;

  /**
   * 留守ボタンのテキストを更新
   */
  function updateAwayButtonText() {
    const awayBtn = timerElement.querySelector('.rsc-away-btn');
    if (!awayBtn || !isAwayMode) return;

    const remaining = Math.max(0, awayModeEndTime - Date.now());
    const minutes = Math.floor(remaining / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);

    awayBtn.textContent = `🏃 ${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  /**
   * 留守モードを停止
   */
  function stopAwayMode() {
    isAwayMode = false;
    awayModeEndTime = null;

    if (awayModeTimeout) {
      clearTimeout(awayModeTimeout);
      awayModeTimeout = null;
    }

    if (updateAwayTimeInterval) {
      clearInterval(updateAwayTimeInterval);
      updateAwayTimeInterval = null;
    }

    const awayBtn = timerElement.querySelector('.rsc-away-btn');
    if (awayBtn) {
      awayBtn.classList.remove('rsc-active');
      awayBtn.textContent = '🏃 留守';
    }

    disableVirtualCamera();
  }

  /**
   * ランダムな画像タイプで仮想カメラを有効化
   */
  async function enableVirtualCameraRandom() {
    const images = await getVirtualCameraImages();
    const types = [];
    if (images?.wave?.length > 0) types.push('wave');
    if (images?.thumbsup?.length > 0) types.push('thumbsup');

    if (types.length === 0) return;

    const randomType = types[Math.floor(Math.random() * types.length)];
    enableVirtualCamera(randomType);
  }

  /**
   * テスト通知ボタンのセットアップ
   */
  function setupTestButton() {
    const testBtn = timerElement.querySelector('.rsc-test-btn');
    if (testBtn) {
      testBtn.addEventListener('click', () => {
        testNotification();
      });
    }
  }

  /**
   * テスト通知を実行
   */
  async function testNotification() {
    const testGesture = { emoji: '👋', message: '話したそうにしています（テスト）' };
    showToast('テストユーザー', testGesture);
    // テストなので設定に関係なく音を鳴らす
    await playNotificationSoundForTest();
    showTimerToast('通知テストを実行しました');
  }

  /**
   * テスト用に通知音を再生（設定の有効/無効に関係なく再生）
   */
  async function playNotificationSoundForTest() {
    try {
      // background.js に通知音再生を依頼（設定された音を使用、デフォルトは法螺貝）
      const soundPreset = settings.notifications?.soundPreset || 'outgoing:outgoing_horn';
      chrome.runtime.sendMessage({
        type: 'PLAY_HAND_SIGN_SOUND',
        preset: soundPreset
      });
    } catch (error) {
      console.error('[HandSign] Failed to play test sound:', error);
    }
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

    // 留守モード中は継続（次の撮影もランダム画像を使用）
    if (isAwayMode) {
      enableVirtualCameraRandom();
      console.log('[HandSign] Away mode: continuing with random image');
      return;
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
   * オフスクリーンAPI経由でハンド検出器を初期化
   */
  async function initHandDetector() {
    if (isDetectorReady) return true;

    try {
      console.log('[HandSign] Initializing hand detector via offscreen API...');
      const result = await chrome.runtime.sendMessage({ type: 'INIT_HAND_DETECTOR' });
      if (result && result.success) {
        isDetectorReady = true;
        console.log('[HandSign] Hand detector initialized via offscreen API');
        return true;
      }
      console.warn('[HandSign] Hand detector initialization failed:', result);
      return false;
    } catch (error) {
      console.error('[HandSign] Failed to initialize hand detector:', error);
      return false;
    }
  }

  // MediaPipe互換の初期化関数
  async function initMediaPipe() {
    return initHandDetector();
  }

  /**
   * 画像からハンドサインを検出（オフスクリーンAPI経由）
   */
  async function detectHandSign(member) {
    try {
      const originalCanvas = await loadImageToCanvas(member.imageUrl);

      // 画像を縮小してメッセージサイズを削減（最大256px）
      const maxSize = 256;
      const scale = Math.min(maxSize / originalCanvas.width, maxSize / originalCanvas.height, 1);
      const width = Math.floor(originalCanvas.width * scale);
      const height = Math.floor(originalCanvas.height * scale);

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(originalCanvas, 0, 0, width, height);

      const imageData = ctx.getImageData(0, 0, width, height);

      // オフスクリーンに画像データを送信
      const result = await chrome.runtime.sendMessage({
        type: 'DETECT_HAND_SIGN',
        imageData: {
          data: Array.from(imageData.data),
          width: imageData.width,
          height: imageData.height
        }
      });

      if (result && result.success && result.gesture) {
        return result.gesture;
      }

      return null;
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
   * ログイン画面かどうかを判定
   */
  function isLoginPage() {
    const path = window.location.pathname;

    // Remoworkのログインページ: /client/login
    if (path === '/client/login' || path.endsWith('/login')) {
      return true;
    }

    // ログインユーザー情報がなければログイン画面とみなす
    const userElement = document.querySelector('.user-picture-container.login-user');
    if (!userElement) {
      return true;
    }

    return false;
  }

  /**
   * 初期化
   */
  async function init() {
    // ログイン画面では初期化しない
    if (isLoginPage()) {
      console.log('[HandSign] Login page detected, skipping initialization');
      return;
    }

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

  // 統合モーダル関連
  let toolsModal = null;
  let cameraStream = null;
  let currentTab = 'camera'; // 'camera' or 'recorder'

  // 録音関連
  let mediaRecorder = null;
  let audioChunks = [];
  let recordingStartTime = null;
  let recorderTimerInterval = null;
  let recordings = [];
  let audioContext = null;
  let audioDestination = null;
  let currentPlayingAudio = null;
  let currentPlayingId = null;

  /**
   * 統合モーダルを作成（撮影 + 録音）
   */
  function createToolsModal() {
    if (toolsModal) return toolsModal;

    toolsModal = document.createElement('div');
    toolsModal.id = 'rsc-tools-modal';
    toolsModal.innerHTML = `
      <div class="rsc-modal-overlay"></div>
      <div class="rsc-modal-dialog">
        <div class="rsc-modal-header">
          <div class="rsc-modal-title"></div>
          <button class="rsc-modal-close">×</button>
        </div>

        <!-- カメラタブ -->
        <div class="rsc-tab-content rsc-tab-camera active">
          <div class="rsc-camera-body">
            <video id="rsc-camera-video" autoplay playsinline></video>
            <canvas id="rsc-camera-canvas" style="display:none;"></canvas>
          </div>
          <div class="rsc-camera-actions">
            <button class="rsc-camera-btn rsc-capture-wave">👋 手を振る</button>
            <button class="rsc-camera-btn rsc-capture-thumbsup">👍 サムズアップ</button>
          </div>
          <div class="rsc-camera-status"></div>
          <div class="rsc-image-counts">
            <span class="rsc-count-wave">👋 0枚</span>
            <span class="rsc-count-thumbsup">👍 0枚</span>
          </div>
          <div class="rsc-saved-images">
            <div class="rsc-saved-images-section" data-type="wave">
              <div class="rsc-saved-images-header">
                <span class="rsc-saved-images-title">👋 手を振る</span>
                <button class="rsc-delete-all-btn" data-type="wave">全削除</button>
              </div>
              <div class="rsc-saved-images-grid rsc-wave-grid"></div>
            </div>
            <div class="rsc-saved-images-section" data-type="thumbsup">
              <div class="rsc-saved-images-header">
                <span class="rsc-saved-images-title">👍 サムズアップ</span>
                <button class="rsc-delete-all-btn" data-type="thumbsup">全削除</button>
              </div>
              <div class="rsc-saved-images-grid rsc-thumbsup-grid"></div>
            </div>
          </div>
        </div>

        <!-- 録音タブ -->
        <div class="rsc-tab-content rsc-tab-recorder">
          <div class="rsc-recorder-status">
            <span class="rsc-recorder-indicator idle"></span>
            <span class="rsc-recorder-status-text">待機中</span>
          </div>
          <div class="rsc-recorder-time">00:00:00</div>
          <div class="rsc-recorder-controls">
            <button class="rsc-recorder-btn rsc-recorder-btn-record" title="録音開始">
              <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
                <circle cx="12" cy="12" r="8"/>
              </svg>
            </button>
            <button class="rsc-recorder-btn rsc-recorder-btn-pause" title="一時停止" disabled>
              <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
              </svg>
            </button>
            <button class="rsc-recorder-btn rsc-recorder-btn-stop" title="停止" disabled>
              <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
                <rect x="6" y="6" width="12" height="12"/>
              </svg>
            </button>
          </div>
          <div class="rsc-recorder-info">
            タブの音声を録音するには「タブの音声を共有」にチェックを入れてください
          </div>
          <div class="rsc-recorder-recordings"></div>
        </div>
      </div>
    `;

    // スタイルを追加
    const style = document.createElement('style');
    style.id = 'rsc-tools-modal-styles';
    style.textContent = `
      #rsc-tools-modal {
        display: none;
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        z-index: 999999;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }
      #rsc-tools-modal.rsc-active {
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .rsc-modal-overlay {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.7);
      }
      .rsc-modal-dialog {
        position: relative;
        background: #1a1a2e;
        border-radius: 16px;
        padding: 0;
        max-width: 720px;
        width: 95%;
        max-height: 95vh;
        overflow: hidden;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
      }
      .rsc-modal-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 16px 20px;
        border-bottom: 1px solid rgba(255,255,255,0.1);
        background: linear-gradient(135deg, #2d3748 0%, #1a202c 100%);
      }
      .rsc-modal-title {
        color: #fff;
        font-size: 16px;
        font-weight: 500;
      }
      .rsc-modal-close {
        background: none;
        border: none;
        color: #888;
        font-size: 28px;
        cursor: pointer;
        padding: 0;
        line-height: 1;
        width: 36px;
        height: 36px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 8px;
        transition: all 0.2s;
      }
      .rsc-modal-close:hover {
        color: #fff;
        background: rgba(255,255,255,0.1);
      }
      .rsc-tab-content {
        display: none;
        padding: 20px;
        max-height: calc(95vh - 70px);
        overflow-y: auto;
      }
      .rsc-tab-content.active {
        display: block;
      }

      /* カメラタブ */
      .rsc-camera-body {
        background: #000;
        border-radius: 12px;
        overflow: hidden;
        margin-bottom: 16px;
      }
      #rsc-camera-video {
        width: 100%;
        display: block;
        transform: scaleX(-1);
      }
      .rsc-camera-actions {
        display: flex;
        gap: 12px;
        justify-content: center;
      }
      .rsc-camera-btn {
        flex: 1;
        padding: 14px 20px;
        border: none;
        border-radius: 10px;
        font-size: 16px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s;
      }
      .rsc-capture-wave {
        background: linear-gradient(135deg, #667eea, #764ba2);
        color: #fff;
      }
      .rsc-capture-thumbsup {
        background: linear-gradient(135deg, #f093fb, #f5576c);
        color: #fff;
      }
      .rsc-camera-btn:hover {
        transform: translateY(-2px);
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.3);
      }
      .rsc-camera-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        transform: none;
      }
      .rsc-camera-status {
        text-align: center;
        color: #888;
        font-size: 14px;
        margin-top: 12px;
        min-height: 20px;
      }
      .rsc-camera-status.rsc-success {
        color: #4ade80;
      }
      .rsc-camera-status.rsc-error {
        color: #f87171;
      }
      .rsc-image-counts {
        display: flex;
        justify-content: center;
        gap: 24px;
        margin-top: 12px;
        color: #a0aec0;
        font-size: 13px;
      }

      /* 保存済み画像一覧 */
      .rsc-saved-images {
        margin-top: 16px;
        max-height: 350px;
        overflow-y: auto;
      }
      .rsc-saved-images-section {
        margin-bottom: 12px;
      }
      .rsc-saved-images-section:last-child {
        margin-bottom: 0;
      }
      .rsc-saved-images-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 8px;
        padding-bottom: 4px;
        border-bottom: 1px solid rgba(255,255,255,0.1);
      }
      .rsc-saved-images-title {
        color: #a0aec0;
        font-size: 12px;
      }
      .rsc-delete-all-btn {
        padding: 2px 8px;
        border: none;
        border-radius: 4px;
        background: rgba(239, 68, 68, 0.2);
        color: #f87171;
        font-size: 11px;
        cursor: pointer;
        transition: all 0.2s;
      }
      .rsc-delete-all-btn:hover {
        background: rgba(239, 68, 68, 0.4);
      }
      .rsc-delete-all-btn:disabled {
        opacity: 0.3;
        cursor: not-allowed;
      }
      .rsc-saved-images-grid {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 8px;
      }
      .rsc-saved-image-item {
        position: relative;
        aspect-ratio: 1;
        border-radius: 8px;
        overflow: hidden;
        background: #000;
      }
      .rsc-saved-image-item img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      .rsc-saved-image-delete {
        position: absolute;
        top: 4px;
        right: 4px;
        width: 20px;
        height: 20px;
        border: none;
        border-radius: 50%;
        background: rgba(239, 68, 68, 0.9);
        color: #fff;
        font-size: 12px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0;
        transition: opacity 0.2s;
      }
      .rsc-saved-image-item:hover .rsc-saved-image-delete {
        opacity: 1;
      }
      .rsc-saved-image-delete:hover {
        background: #dc2626;
      }
      .rsc-saved-images-empty {
        color: #718096;
        font-size: 12px;
        text-align: center;
        padding: 8px;
      }

      /* 録音タブ */
      .rsc-recorder-status {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        margin-bottom: 16px;
      }
      .rsc-recorder-indicator {
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background: #4a5568;
      }
      .rsc-recorder-indicator.recording {
        background: #ef4444;
        animation: rsc-pulse 1s infinite;
      }
      .rsc-recorder-indicator.paused {
        background: #f59e0b;
      }
      @keyframes rsc-pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.5; }
      }
      .rsc-recorder-status-text {
        color: #a0aec0;
        font-size: 14px;
      }
      .rsc-recorder-time {
        text-align: center;
        font-size: 48px;
        font-weight: 200;
        color: #fff;
        font-variant-numeric: tabular-nums;
        margin-bottom: 20px;
      }
      .rsc-recorder-controls {
        display: flex;
        justify-content: center;
        gap: 16px;
        margin-bottom: 16px;
      }
      .rsc-recorder-btn {
        width: 56px;
        height: 56px;
        border: none;
        border-radius: 50%;
        background: rgba(255,255,255,0.1);
        color: #fff;
        cursor: pointer;
        transition: all 0.2s;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .rsc-recorder-btn:hover:not(:disabled) {
        background: rgba(255,255,255,0.2);
        transform: scale(1.05);
      }
      .rsc-recorder-btn:disabled {
        opacity: 0.3;
        cursor: not-allowed;
      }
      .rsc-recorder-btn-record {
        background: #ef4444;
      }
      .rsc-recorder-btn-record:hover:not(:disabled) {
        background: #dc2626;
      }
      .rsc-recorder-info {
        text-align: center;
        color: #718096;
        font-size: 12px;
        margin-bottom: 16px;
        padding: 12px;
        background: rgba(255,255,255,0.05);
        border-radius: 8px;
      }
      .rsc-recorder-recordings {
        max-height: 200px;
        overflow-y: auto;
      }
      .rsc-recorder-recordings-title {
        color: #a0aec0;
        font-size: 13px;
        margin-bottom: 10px;
        padding-bottom: 8px;
        border-bottom: 1px solid rgba(255,255,255,0.1);
      }
      .rsc-recording-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 10px 12px;
        background: rgba(255,255,255,0.05);
        border-radius: 8px;
        margin-bottom: 8px;
      }
      .rsc-recording-info {
        flex: 1;
        min-width: 0;
      }
      .rsc-recording-name {
        color: #fff;
        font-size: 13px;
        display: block;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .rsc-recording-meta {
        color: #718096;
        font-size: 11px;
      }
      .rsc-recording-actions {
        display: flex;
        gap: 6px;
      }
      .rsc-recording-btn {
        width: 32px;
        height: 32px;
        border: none;
        border-radius: 6px;
        background: rgba(255,255,255,0.1);
        color: #a0aec0;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s;
      }
      .rsc-recording-btn:hover {
        background: rgba(255,255,255,0.2);
        color: #fff;
      }
      .rsc-recording-btn.playing {
        background: #ef4444;
        color: #fff;
      }
    `;
    document.head.appendChild(style);
    document.body.appendChild(toolsModal);

    // イベント設定
    toolsModal.querySelector('.rsc-modal-overlay').addEventListener('click', closeToolsModal);
    toolsModal.querySelector('.rsc-modal-close').addEventListener('click', closeToolsModal);
    toolsModal.querySelector('.rsc-capture-wave').addEventListener('click', () => captureImage('wave'));
    toolsModal.querySelector('.rsc-capture-thumbsup').addEventListener('click', () => captureImage('thumbsup'));

    // 録音ボタン
    toolsModal.querySelector('.rsc-recorder-btn-record').addEventListener('click', startRecording);
    toolsModal.querySelector('.rsc-recorder-btn-pause').addEventListener('click', togglePauseRecording);
    toolsModal.querySelector('.rsc-recorder-btn-stop').addEventListener('click', stopRecording);

    // 全削除ボタン
    toolsModal.querySelectorAll('.rsc-delete-all-btn').forEach(btn => {
      btn.addEventListener('click', () => deleteAllImages(btn.dataset.type));
    });

    return toolsModal;
  }

  /**
   * タブを切り替え
   */
  function switchTab(tabName) {
    if (!toolsModal) return;
    currentTab = tabName;

    // タイトルを更新
    const titleEl = toolsModal.querySelector('.rsc-modal-title');
    if (titleEl) {
      titleEl.textContent = tabName === 'camera' ? '📷 事前撮影' : '🎙️ 録音';
    }

    // コンテンツの表示切り替え
    toolsModal.querySelector('.rsc-tab-camera').classList.toggle('active', tabName === 'camera');
    toolsModal.querySelector('.rsc-tab-recorder').classList.toggle('active', tabName === 'recorder');

    // カメラタブに切り替えたらカメラ起動
    if (tabName === 'camera' && !cameraStream) {
      startCamera();
    }
  }

  /**
   * カメラを起動
   */
  async function startCamera() {
    const video = document.getElementById('rsc-camera-video');
    const status = toolsModal.querySelector('.rsc-camera-status');
    const buttons = toolsModal.querySelectorAll('.rsc-camera-btn');

    buttons.forEach(btn => btn.disabled = true);
    status.textContent = 'カメラを起動中...';
    status.className = 'rsc-camera-status';

    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' }
      });
      video.srcObject = cameraStream;
      buttons.forEach(btn => btn.disabled = false);
      status.textContent = 'ポーズをとって撮影ボタンをクリック';
      updateImageCounts();
    } catch (error) {
      console.error('[HandSign] Camera error:', error);
      let message = 'カメラへのアクセスに失敗しました';
      if (error.name === 'NotAllowedError') {
        message = 'カメラへのアクセスが拒否されました';
      } else if (error.name === 'NotFoundError') {
        message = 'カメラが見つかりません';
      } else if (error.name === 'NotReadableError') {
        message = 'カメラが他のアプリで使用中です';
      }
      status.textContent = message;
      status.className = 'rsc-camera-status rsc-error';
    }
  }

  /**
   * 画像枚数を更新
   */
  async function updateImageCounts() {
    if (!toolsModal) return;
    const result = await chrome.storage.local.get('virtualCameraImages');
    const images = result.virtualCameraImages || { wave: [], thumbsup: [] };

    const waveCount = toolsModal.querySelector('.rsc-count-wave');
    const thumbsupCount = toolsModal.querySelector('.rsc-count-thumbsup');

    if (waveCount) waveCount.textContent = `👋 ${images.wave?.length || 0}枚`;
    if (thumbsupCount) thumbsupCount.textContent = `👍 ${images.thumbsup?.length || 0}枚`;

    // 保存済み画像一覧を更新
    updateSavedImagesGrid('wave', images.wave || []);
    updateSavedImagesGrid('thumbsup', images.thumbsup || []);
  }

  /**
   * 保存済み画像のグリッドを更新
   */
  function updateSavedImagesGrid(type, imageList) {
    if (!toolsModal) return;
    const grid = toolsModal.querySelector(`.rsc-${type}-grid`);
    if (!grid) return;

    if (imageList.length === 0) {
      grid.innerHTML = '<div class="rsc-saved-images-empty">画像なし</div>';
      return;
    }

    grid.innerHTML = imageList.map((img, index) => `
      <div class="rsc-saved-image-item" data-type="${type}" data-index="${index}">
        <img src="${img}" alt="${type} ${index + 1}">
        <button class="rsc-saved-image-delete" title="削除">×</button>
      </div>
    `).join('');

    // 削除ボタンのイベント設定
    grid.querySelectorAll('.rsc-saved-image-delete').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const item = btn.closest('.rsc-saved-image-item');
        const imgType = item.dataset.type;
        const imgIndex = parseInt(item.dataset.index);
        await deleteImage(imgType, imgIndex);
      });
    });
  }

  /**
   * 画像を削除
   */
  async function deleteImage(type, index) {
    const result = await chrome.storage.local.get('virtualCameraImages');
    const images = result.virtualCameraImages || { wave: [], thumbsup: [] };

    if (!images[type] || index >= images[type].length) return;

    // 削除確認
    if (!confirm(`この画像を削除しますか？`)) return;

    // 画像を削除
    images[type].splice(index, 1);
    await chrome.storage.local.set({ virtualCameraImages: images });

    // UIを更新
    updateImageCounts();

    const status = toolsModal.querySelector('.rsc-camera-status');
    if (status) {
      status.textContent = '画像を削除しました';
      status.className = 'rsc-camera-status';
    }
  }

  /**
   * 画像を全削除
   */
  async function deleteAllImages(type) {
    const result = await chrome.storage.local.get('virtualCameraImages');
    const images = result.virtualCameraImages || { wave: [], thumbsup: [] };

    const count = images[type]?.length || 0;
    if (count === 0) return;

    const emoji = type === 'wave' ? '👋' : '👍';
    if (!confirm(`${emoji} の画像を全て削除しますか？（${count}枚）`)) return;

    // 全削除
    images[type] = [];
    await chrome.storage.local.set({ virtualCameraImages: images });

    // UIを更新
    updateImageCounts();

    const status = toolsModal.querySelector('.rsc-camera-status');
    if (status) {
      status.textContent = `${emoji} の画像を全て削除しました`;
      status.className = 'rsc-camera-status';
    }
  }

  /**
   * 統合モーダルを開く
   */
  async function openToolsModal(initialTab = 'camera') {
    createToolsModal();
    toolsModal.classList.add('rsc-active');
    currentTab = initialTab;
    switchTab(initialTab);

    if (initialTab === 'camera') {
      startCamera();
    }
  }

  /**
   * 統合モーダルを閉じる
   */
  function closeToolsModal() {
    // カメラストリームを停止
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      cameraStream = null;
    }

    // 録音中なら停止
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      stopRecording();
    }

    if (toolsModal) {
      toolsModal.classList.remove('rsc-active');
      const video = document.getElementById('rsc-camera-video');
      if (video) video.srcObject = null;
    }
  }

  /**
   * 3秒カウントダウンを表示
   */
  function showCountdown(seconds) {
    return new Promise((resolve) => {
      const video = document.getElementById('rsc-camera-video');
      if (!video) {
        resolve();
        return;
      }

      // カウントダウンオーバーレイを作成
      let overlay = document.getElementById('rsc-countdown-overlay');
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'rsc-countdown-overlay';
        overlay.style.cssText = `
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(0,0,0,0.5);
          z-index: 10;
        `;
        video.parentElement.style.position = 'relative';
        video.parentElement.appendChild(overlay);
      }

      let count = seconds;
      const updateCount = () => {
        overlay.innerHTML = `<span style="font-size: 72px; color: #fff; font-weight: bold; text-shadow: 0 2px 8px rgba(0,0,0,0.5);">${count}</span>`;
        if (count > 0) {
          count--;
          setTimeout(updateCount, 1000);
        } else {
          overlay.remove();
          resolve();
        }
      };
      updateCount();
    });
  }

  /**
   * 画像を撮影して保存
   */
  async function captureImage(type) {
    const video = document.getElementById('rsc-camera-video');
    const canvas = document.getElementById('rsc-camera-canvas');
    const status = toolsModal.querySelector('.rsc-camera-status');
    const buttons = toolsModal.querySelectorAll('.rsc-camera-btn');

    if (!video || !video.srcObject) {
      status.textContent = 'カメラが起動していません';
      status.className = 'rsc-camera-status rsc-error';
      return;
    }

    // ボタンを無効化
    buttons.forEach(btn => btn.disabled = true);
    status.textContent = '撮影準備中...';
    status.className = 'rsc-camera-status';

    // 3秒カウントダウン
    await showCountdown(3);

    // キャンバスに描画（左右反転）
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0);

    // ボタンを再度有効化
    buttons.forEach(btn => btn.disabled = false);

    // Base64に変換
    const imageData = canvas.toDataURL('image/jpeg', 0.8);

    // ストレージに保存
    try {
      const result = await chrome.storage.local.get('virtualCameraImages');
      const images = result.virtualCameraImages || { wave: [], thumbsup: [] };

      if (images[type].length >= 12) {
        status.textContent = '登録上限（12枚）に達しています';
        status.className = 'rsc-camera-status rsc-error';
        return;
      }

      images[type].push(imageData);
      await chrome.storage.local.set({ virtualCameraImages: images });

      status.textContent = `${type === 'wave' ? '👋' : '👍'} 保存しました（${images[type].length}/12枚）`;
      status.className = 'rsc-camera-status rsc-success';

      // 枚数を更新
      updateImageCounts();

      // 成功をポップアップに通知
      chrome.runtime.sendMessage({
        type: 'CAMERA_CAPTURE_SUCCESS',
        imageType: type,
        count: images[type].length
      }).catch(() => {});

    } catch (error) {
      console.error('[HandSign] Failed to save image:', error);
      status.textContent = '保存に失敗しました';
      status.className = 'rsc-camera-status rsc-error';
    }
  }

  // ===== 録音機能 =====

  /**
   * 録音を開始
   */
  async function startRecording() {
    try {
      const stream = await captureAudioStream();

      if (!stream) {
        showRecorderError('音声ストリームを取得できませんでした');
        return;
      }

      audioChunks = [];
      recordingStartTime = Date.now();

      mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus'
      });

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunks.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(audioChunks, { type: 'audio/webm' });
        saveRecordingData(blob);
      };

      mediaRecorder.start(1000);

      updateRecorderUI('recording');
      startRecorderTimer();

      console.log('[HandSign] Recording started');

    } catch (error) {
      console.error('[HandSign] Failed to start recording:', error);
      showRecorderError('録音を開始できませんでした');
    }
  }

  /**
   * 音声ストリームをキャプチャ
   */
  async function captureAudioStream() {
    try {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      audioDestination = audioContext.createMediaStreamDestination();

      let hasMic = false;
      let hasTabAudio = false;

      // マイク
      try {
        const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const micSource = audioContext.createMediaStreamSource(micStream);
        micSource.connect(audioDestination);
        hasMic = true;
      } catch (e) {
        console.warn('[HandSign] Microphone not available:', e);
      }

      // 画面共有でタブ音声
      try {
        showRecorderInfo('画面共有ダイアログで「タブの音声を共有」にチェックを入れてください');

        const displayStream = await navigator.mediaDevices.getDisplayMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            suppressLocalAudioPlayback: false
          },
          video: { width: 1, height: 1, frameRate: 1 },
          preferCurrentTab: true,
          selfBrowserSurface: 'include',
          systemAudio: 'include'
        });

        const audioTracks = displayStream.getAudioTracks();

        if (audioTracks.length > 0) {
          const audioOnlyStream = new MediaStream(audioTracks);
          const tabSource = audioContext.createMediaStreamSource(audioOnlyStream);
          tabSource.connect(audioDestination);
          hasTabAudio = true;

          displayStream.getVideoTracks().forEach(track => track.stop());
        } else {
          showRecorderError('タブの音声が共有されていません');
        }
      } catch (e) {
        console.warn('[HandSign] Tab audio capture failed:', e);
      }

      if (!hasMic && !hasTabAudio) {
        throw new Error('音声ソースが見つかりません');
      }

      const sources = [];
      if (hasMic) sources.push('マイク');
      if (hasTabAudio) sources.push('タブ音声');
      showRecorderInfo(`録音開始: ${sources.join(' + ')}`);

      return audioDestination.stream;

    } catch (error) {
      console.error('[HandSign] Failed to capture audio:', error);
      return null;
    }
  }

  /**
   * 録音の一時停止/再開をトグル
   */
  function togglePauseRecording() {
    if (!mediaRecorder) return;

    if (mediaRecorder.state === 'recording') {
      mediaRecorder.pause();
      stopRecorderTimer();
      updateRecorderUI('paused');
    } else if (mediaRecorder.state === 'paused') {
      mediaRecorder.resume();
      startRecorderTimer();
      updateRecorderUI('recording');
    }
  }

  /**
   * 録音を停止
   */
  function stopRecording() {
    if (mediaRecorder && (mediaRecorder.state === 'recording' || mediaRecorder.state === 'paused')) {
      mediaRecorder.stop();
      stopRecorderTimer();
      updateRecorderUI('idle');
    }
  }

  /**
   * 録音データを保存
   */
  function saveRecordingData(blob) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const recording = {
      id: Date.now(),
      name: `録音_${timestamp}`,
      blob: blob,
      duration: formatRecorderTime(Date.now() - recordingStartTime),
      date: new Date().toLocaleString('ja-JP')
    };

    recordings.unshift(recording);
    updateRecordingsList();
  }

  /**
   * 録音リストを更新
   */
  function updateRecordingsList() {
    if (!toolsModal) return;
    const container = toolsModal.querySelector('.rsc-recorder-recordings');
    if (!container) return;

    if (recordings.length === 0) {
      container.innerHTML = '';
      return;
    }

    let html = '<div class="rsc-recorder-recordings-title">録音履歴</div>';

    for (const recording of recordings.slice(0, 5)) {
      const isPlaying = currentPlayingId === recording.id;
      html += `
        <div class="rsc-recording-item" data-id="${recording.id}">
          <div class="rsc-recording-info">
            <span class="rsc-recording-name">${recording.name}</span>
            <span class="rsc-recording-meta">${recording.duration}</span>
          </div>
          <div class="rsc-recording-actions">
            <button class="rsc-recording-btn rsc-recording-play ${isPlaying ? 'playing' : ''}" data-id="${recording.id}" title="${isPlaying ? '停止' : '再生'}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="${isPlaying ? 'display:none' : ''}">
                <path d="M8 5v14l11-7z"/>
              </svg>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="${isPlaying ? '' : 'display:none'}">
                <path d="M6 6h12v12H6z"/>
              </svg>
            </button>
            <button class="rsc-recording-btn rsc-recording-download" data-id="${recording.id}" title="ダウンロード">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
              </svg>
            </button>
            <button class="rsc-recording-btn rsc-recording-delete" data-id="${recording.id}" title="削除">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
              </svg>
            </button>
          </div>
        </div>
      `;
    }

    container.innerHTML = html;

    // イベントハンドラー
    container.querySelectorAll('.rsc-recording-play').forEach(btn => {
      btn.addEventListener('click', () => playRecordingById(parseInt(btn.dataset.id)));
    });
    container.querySelectorAll('.rsc-recording-download').forEach(btn => {
      btn.addEventListener('click', () => downloadRecordingById(parseInt(btn.dataset.id)));
    });
    container.querySelectorAll('.rsc-recording-delete').forEach(btn => {
      btn.addEventListener('click', () => deleteRecordingById(parseInt(btn.dataset.id)));
    });
  }

  /**
   * 録音を再生
   */
  function playRecordingById(id) {
    if (currentPlayingId === id) {
      stopPlaybackAudio();
      return;
    }

    stopPlaybackAudio();

    const recording = recordings.find(r => r.id === id);
    if (!recording) return;

    const url = URL.createObjectURL(recording.blob);
    const audio = new Audio(url);
    currentPlayingAudio = audio;
    currentPlayingId = id;

    updateRecordingsList();

    audio.play();

    audio.onended = audio.onerror = () => {
      URL.revokeObjectURL(url);
      currentPlayingAudio = null;
      currentPlayingId = null;
      updateRecordingsList();
    };
  }

  /**
   * 再生を停止
   */
  function stopPlaybackAudio() {
    if (currentPlayingAudio) {
      currentPlayingAudio.pause();
      currentPlayingAudio.currentTime = 0;
      URL.revokeObjectURL(currentPlayingAudio.src);
      currentPlayingAudio = null;
    }
    currentPlayingId = null;
    updateRecordingsList();
  }

  /**
   * 録音をダウンロード
   */
  function downloadRecordingById(id) {
    const recording = recordings.find(r => r.id === id);
    if (!recording) return;

    const url = URL.createObjectURL(recording.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${recording.name}.webm`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /**
   * 録音を削除
   */
  function deleteRecordingById(id) {
    const index = recordings.findIndex(r => r.id === id);
    if (index === -1) return;

    const recording = recordings[index];
    if (!confirm(`「${recording.name}」を削除しますか？`)) return;

    if (currentPlayingId === id) {
      stopPlaybackAudio();
    }

    recordings.splice(index, 1);
    updateRecordingsList();
  }

  /**
   * 録音UIを更新
   */
  function updateRecorderUI(state) {
    if (!toolsModal) return;

    const indicator = toolsModal.querySelector('.rsc-recorder-indicator');
    const statusText = toolsModal.querySelector('.rsc-recorder-status-text');
    const recordBtn = toolsModal.querySelector('.rsc-recorder-btn-record');
    const pauseBtn = toolsModal.querySelector('.rsc-recorder-btn-pause');
    const stopBtn = toolsModal.querySelector('.rsc-recorder-btn-stop');

    indicator.className = 'rsc-recorder-indicator ' + state;

    switch (state) {
      case 'recording':
        statusText.textContent = '録音中';
        recordBtn.disabled = true;
        pauseBtn.disabled = false;
        stopBtn.disabled = false;
        break;
      case 'paused':
        statusText.textContent = '一時停止';
        recordBtn.disabled = true;
        pauseBtn.disabled = false;
        stopBtn.disabled = false;
        break;
      case 'idle':
      default:
        statusText.textContent = '待機中';
        recordBtn.disabled = false;
        pauseBtn.disabled = true;
        stopBtn.disabled = true;
        if (toolsModal) {
          toolsModal.querySelector('.rsc-recorder-time').textContent = '00:00:00';
        }
        break;
    }
  }

  /**
   * 録音タイマーを開始
   */
  function startRecorderTimer() {
    recorderTimerInterval = setInterval(() => {
      const elapsed = Date.now() - recordingStartTime;
      const timeEl = toolsModal?.querySelector('.rsc-recorder-time');
      if (timeEl) {
        timeEl.textContent = formatRecorderTime(elapsed);
      }
    }, 1000);
  }

  /**
   * 録音タイマーを停止
   */
  function stopRecorderTimer() {
    if (recorderTimerInterval) {
      clearInterval(recorderTimerInterval);
      recorderTimerInterval = null;
    }
  }

  /**
   * 時間をフォーマット
   */
  function formatRecorderTime(ms) {
    const seconds = Math.floor(ms / 1000);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return [hours, minutes, secs].map(n => n.toString().padStart(2, '0')).join(':');
  }

  /**
   * 録音エラーを表示
   */
  function showRecorderError(message) {
    const info = toolsModal?.querySelector('.rsc-recorder-info');
    if (info) {
      info.textContent = message;
      info.style.background = 'rgba(239, 68, 68, 0.2)';
      info.style.color = '#f87171';
    }
  }

  /**
   * 録音情報を表示
   */
  function showRecorderInfo(message) {
    const info = toolsModal?.querySelector('.rsc-recorder-info');
    if (info) {
      info.textContent = message;
      info.style.background = 'rgba(255,255,255,0.05)';
      info.style.color = '#718096';
    }
  }

  // メッセージを受信
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // 通知音再生
    if (message.type === 'PLAY_NOTIFICATION_SOUND' && message.url) {
      const audio = new Audio(message.url);
      audio.volume = 0.7;
      audio.play().catch(console.error);
      sendResponse({ success: true });
      return true;
    }

    // カメラモーダルを開く（統合モーダルに変更）
    if (message.type === 'OPEN_CAMERA_MODAL') {
      openToolsModal('camera');
      sendResponse({ success: true });
      return true;
    }

    // カメラモーダルを閉じる
    if (message.type === 'CLOSE_CAMERA_MODAL') {
      closeToolsModal();
      sendResponse({ success: true });
      return true;
    }

    // 録音モーダルを開く
    if (message.type === 'OPEN_RECORDER_MODAL') {
      openToolsModal('recorder');
      sendResponse({ success: true });
      return true;
    }

    return false;
  });

  /**
   * ウィジェットを非表示にする（ログアウト時）
   */
  function hideAllWidgets() {
    if (timerElement) {
      timerElement.style.display = 'none';
    }
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    console.log('[HandSign] Widgets hidden (logged out)');
  }

  /**
   * ウィジェットを表示する（ログイン時）
   */
  function showAllWidgets() {
    if (timerElement) {
      updateTimerVisibility();
    }
    if (!timerInterval) {
      startTimer();
    }
    console.log('[HandSign] Widgets shown (logged in)');
  }

  /**
   * ページ遷移を監視（SPA対応）
   */
  function watchPageNavigation() {
    let lastPath = window.location.pathname;
    let wasLoginPage = isLoginPage();

    // URL変更を監視
    const checkNavigation = () => {
      const currentPath = window.location.pathname;
      const currentlyLoginPage = isLoginPage();

      if (currentPath !== lastPath || currentlyLoginPage !== wasLoginPage) {
        lastPath = currentPath;

        if (currentlyLoginPage && !wasLoginPage) {
          // ログアウト: ログイン画面に遷移
          hideAllWidgets();
        } else if (!currentlyLoginPage && wasLoginPage) {
          // ログイン: ログイン画面から離脱
          // 少し待ってから初期化（DOMが構築されるのを待つ）
          setTimeout(() => {
            if (!timerElement) {
              init();
            } else {
              showAllWidgets();
            }
          }, 1000);
        }

        wasLoginPage = currentlyLoginPage;
      }
    };

    // popstate（ブラウザの戻る/進む）
    window.addEventListener('popstate', checkNavigation);

    // History APIのpushState/replaceStateを監視
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function(...args) {
      originalPushState.apply(this, args);
      setTimeout(checkNavigation, 100);
    };

    history.replaceState = function(...args) {
      originalReplaceState.apply(this, args);
      setTimeout(checkNavigation, 100);
    };

    // 定期チェック（フォールバック）
    setInterval(checkNavigation, 2000);
  }

  // ページ読み込み完了後に初期化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      init();
      watchPageNavigation();
    });
  } else {
    init();
    watchPageNavigation();
  }
})();

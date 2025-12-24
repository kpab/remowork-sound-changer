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

  // LLM設定（自動構造化用）
  let llmSettings = null;

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
          <span class="rsc-countdown-badge">🔇OFF</span>
        </div>
      </div>
      <div class="rsc-timer-rows">
        <div class="rsc-timer-row">
          <button class="rsc-send-btn" data-type="wave" title="👋を次回送信">👋</button>
          <button class="rsc-send-btn" data-type="thumbsup" title="👍を次回送信">👍</button>
          <button class="rsc-away-btn" title="留守モード（30分間自動送信）">🏃 留守</button>
          <div class="rsc-timer-divider"></div>
          <button class="rsc-record-btn" title="録音">🎙️ 録音</button>
        </div>
        <div class="rsc-timer-row">
          <button class="rsc-tools-btn" title="事前撮影">📸 事前撮影</button>
          <button class="rsc-sound-btn" title="音声変更">🔊 音声変更</button>
          <button class="rsc-notify-btn" title="通知設定">🔔 通知設定</button>
        </div>
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
          user-select: none;
        }
        #rsc-photo-timer:hover {
          opacity: 1;
        }
        .rsc-timer-main {
          display: flex;
          align-items: center;
          gap: 10px;
          cursor: pointer;
          border-radius: 6px;
          padding: 4px;
          margin: -4px;
          transition: background 0.2s;
        }
        .rsc-timer-main:hover {
          background: rgba(255,255,255,0.1);
        }
        .rsc-countdown-badge {
          font-size: 9px;
          padding: 1px 5px;
          border-radius: 3px;
          background: rgba(255,255,255,0.15);
          color: #a0aec0;
          margin-top: 2px;
        }
        .rsc-timer-main.rsc-countdown-enabled .rsc-countdown-badge {
          background: rgba(72, 187, 120, 0.3);
          color: #68d391;
        }
        .rsc-timer-rows {
          display: flex;
          flex-direction: column;
          gap: 6px;
          margin-left: 12px;
          padding-left: 12px;
          border-left: 1px solid rgba(255,255,255,0.2);
        }
        .rsc-timer-row {
          display: flex;
          align-items: center;
          gap: 6px;
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
        .rsc-away-btn {
          height: 32px;
          padding: 0 10px;
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
        .rsc-notify-btn {
          height: 32px;
          padding: 0 10px;
          border: none;
          border-radius: 6px;
          background: linear-gradient(135deg, #ed8936 0%, #dd6b20 100%);
          font-size: 13px;
          color: #fff;
          cursor: pointer;
          transition: all 0.2s;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 4px;
          white-space: nowrap;
        }
        .rsc-notify-btn:hover {
          background: linear-gradient(135deg, #f6ad55 0%, #ed8936 100%);
          transform: scale(1.05);
        }
        .rsc-tools-btn {
          height: 32px;
          padding: 0 10px;
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
        .rsc-sound-btn {
          height: 32px;
          padding: 0 10px;
          border: none;
          border-radius: 6px;
          background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
          font-size: 13px;
          color: #fff;
          cursor: pointer;
          transition: all 0.2s;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 4px;
          white-space: nowrap;
        }
        .rsc-sound-btn:hover {
          background: linear-gradient(135deg, #60a5fa 0%, #3b82f6 100%);
          transform: scale(1.05);
        }
        .rsc-timer-divider {
          width: 1px;
          height: 24px;
          background: rgba(255,255,255,0.3);
          margin: 0 4px;
        }
        .rsc-record-btn {
          height: 32px;
          padding: 0 10px;
          border: none;
          border-radius: 6px;
          font-size: 13px;
          color: #fff;
          cursor: pointer;
          transition: all 0.2s;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 4px;
          white-space: nowrap;
          background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
        }
        .rsc-record-btn:hover {
          background: linear-gradient(135deg, #f87171 0%, #ef4444 100%);
          transform: scale(1.05);
        }
      `;
      document.head.appendChild(style);
    }

    // ボタンのクリックハンドラー
    setupSendButtons();

    // 通知設定ボタンのハンドラー
    setupNotifyButton();

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

    // 録音ボタン（3ボタン）
    setupTimerRecordButtons();

    // 音声設定ボタン
    const soundBtn = timerElement.querySelector('.rsc-sound-btn');
    if (soundBtn) {
      soundBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openSoundSettingsModal();
      });
    }

    // タイマーメイン（カウントダウン音ON/OFF）
    const timerMain = timerElement.querySelector('.rsc-timer-main');
    if (timerMain) {
      timerMain.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleCountdownSound();
      });
      // 初期状態を設定
      updateCountdownSoundIndicator();
    }
  }

  /**
   * カウントダウン音ON/OFF切り替え
   */
  async function toggleCountdownSound() {
    settings.countdown = settings.countdown || {};
    settings.countdown.enabled = !settings.countdown.enabled;
    await chrome.storage.local.set({ handSignSettings: settings });
    updateCountdownSoundIndicator();
    showTimerToast(settings.countdown.enabled ? 'カウントダウン音 ON' : 'カウントダウン音 OFF');
  }

  /**
   * カウントダウン音の表示インジケーター更新
   */
  function updateCountdownSoundIndicator() {
    const timerMain = timerElement?.querySelector('.rsc-timer-main');
    const badge = timerElement?.querySelector('.rsc-countdown-badge');
    if (timerMain && badge) {
      if (settings.countdown?.enabled) {
        timerMain.classList.add('rsc-countdown-enabled');
        badge.textContent = '🔊ON';
      } else {
        timerMain.classList.remove('rsc-countdown-enabled');
        badge.textContent = '🔇OFF';
      }
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
    // ボタンクリックは除外（タイマーメインのクリックも含む）
    if (e.target.closest('.rsc-send-btn') || e.target.closest('.rsc-notify-btn') || e.target.closest('.rsc-tools-btn') || e.target.closest('.rsc-away-btn') || e.target.closest('.rsc-record-btn') || e.target.closest('.rsc-sound-btn') || e.target.closest('.rsc-timer-main')) return;

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
   * 通知設定ボタンのセットアップ
   */
  function setupNotifyButton() {
    const notifyBtn = timerElement.querySelector('.rsc-notify-btn');
    if (notifyBtn) {
      notifyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        // ハンドサイン設定モーダルを開く
        openHandSignSettingsModal();
      });
    }
  }

  /**
   * タイマーUIの録音ボタンをセットアップ
   */
  function setupTimerRecordButtons() {
    const recordBtn = timerElement.querySelector('.rsc-record-btn');

    if (recordBtn) {
      recordBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openToolsModal('recorder');
      });
    }
  }

  // 現在の録音用ストリーム（停止時に解放するため保持）
  let currentRecordingStream = null;

  /**
   * 録音用ストリームを解放
   */
  function releaseRecordingStream() {
    if (currentRecordingStream) {
      // 複数ストリームの場合
      if (currentRecordingStream.streams) {
        currentRecordingStream.streams.forEach(stream => {
          stream.getTracks().forEach(track => track.stop());
        });
      } else {
        // 単一ストリームの場合
        currentRecordingStream.getTracks().forEach(track => track.stop());
      }
      currentRecordingStream = null;
      console.log('[HandSign] Recording stream released');
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
   * カウントダウン音を再生
   */
  async function playCountdownSound() {
    if (!settings.countdown?.enabled) return;

    const soundPreset = settings.countdown?.soundPreset || 'countdown:countdown_button2';
    const [category, presetId] = soundPreset.split(':');

    // 無音の場合はスキップ
    if (presetId === 'countdown_none') return;

    // presetSoundsがまだロードされていない場合はロード
    if (!presetSounds) {
      try {
        const result = await chrome.runtime.sendMessage({ type: 'GET_PRESET_SOUNDS' });
        if (result && result.presets) {
          presetSounds = result.presets;
        }
      } catch (e) {
        console.warn('[HandSign] Failed to load preset sounds:', e);
        return;
      }
    }

    if (!presetSounds) return;

    try {
      const presets = presetSounds[category];
      if (presets) {
        const preset = presets.find(p => p.id === presetId);
        if (preset && preset.file) {
          const soundUrl = chrome.runtime.getURL(`sounds/${category}/${preset.file}`);
          const audio = new Audio(soundUrl);
          audio.volume = 0.6;
          await audio.play();
        }
      }
    } catch (error) {
      console.error('[HandSign] Failed to play countdown sound:', error);
    }
  }

  /**
   * タイマーを1秒減らす
   */
  function tickTimer() {
    if (remainingSeconds > 0) {
      remainingSeconds--;
      updateTimerDisplay();

      // 5秒以下でカウントダウン音を再生
      if (remainingSeconds <= 5 && remainingSeconds > 0) {
        playCountdownSound();
      }
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
    // LLM設定の変更を監視（APIキー変更時にリロード不要に）
    if (namespace === 'local' && changes.llmSettings) {
      llmSettings = changes.llmSettings.newValue;
      console.log('[HandSign] LLM settings updated:', llmSettings?.enabled ? 'enabled' : 'disabled');
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
  let recordingsDb = null;
  const RECORDINGS_DB_NAME = 'remowork-recordings';
  const RECORDINGS_STORE_NAME = 'recordings';

  // 文字起こし関連（ページコンテキスト inject.js 経由）
  let transcriptText = '';
  let isTranscribing = false;

  // 自動構造化関連
  let structureInterval = null;
  let lastStructuredText = '';

  // レート制限管理（Gemini無料枠: 15 RPM / 250 RPD）
  const RATE_LIMIT = {
    gemini: {
      rpm: 14,           // 15 RPM - 1マージン
      rpd: 240,          // 250 RPD - 10マージン
      minInterval: 4500  // 60秒/14 ≈ 4.3秒 → 4.5秒
    },
    openai: {
      rpm: 60,
      rpd: 10000,
      minInterval: 1000
    },
    claude: {
      rpm: 60,
      rpd: 10000,
      minInterval: 1000
    },
    custom: {
      rpm: 60,
      rpd: 10000,
      minInterval: 1000
    }
  };
  let lastRequestTime = 0;
  let requestCountToday = 0;
  let requestCountMinute = 0;
  let lastMinuteReset = Date.now();
  let nextRequestCountdown = null;

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
          <!-- 上部：タイマーと履歴を横並び -->
          <div class="rsc-recorder-top">
            <div class="rsc-recorder-timer-section">
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
            </div>
            <div class="rsc-recorder-history-section">
              <div class="rsc-recorder-history-title">📁 履歴</div>
              <div class="rsc-recorder-recordings"></div>
            </div>
          </div>

          <!-- メモ・文字起こしエリア -->
          <div class="rsc-meeting-notes">
            <div class="rsc-notes-section">
              <div class="rsc-notes-header">
                <span class="rsc-notes-title">✏️ メモ</span>
                <button class="rsc-copy-btn" data-target="manual-notes" title="コピー">📋</button>
              </div>
              <textarea class="rsc-manual-notes" placeholder="メモを入力..."></textarea>
            </div>
            <div class="rsc-notes-section">
              <div class="rsc-notes-header">
                <span class="rsc-notes-title">🤖 自動構造化メモ</span>
                <div class="rsc-structure-controls">
                  <span class="rsc-rate-limit-status"></span>
                  <button class="rsc-structure-btn" title="今すぐ構造化">🔄</button>
                  <button class="rsc-copy-btn" data-target="structured-notes" title="コピー">📋</button>
                </div>
              </div>
              <div class="rsc-structured-notes-area">（AIタブで設定後、録音中に自動構造化されます）</div>
            </div>
            <div class="rsc-notes-section">
              <div class="rsc-notes-header">
                <span class="rsc-notes-title">📝 文字起こし</span>
                <div class="rsc-transcript-controls">
                  <label class="rsc-notes-toggle">
                    <input type="checkbox" class="rsc-transcript-toggle" checked>
                    <span>自動文字起こし</span>
                  </label>
                  <button class="rsc-copy-btn" data-target="transcript" title="コピー">📋</button>
                </div>
              </div>
              <div class="rsc-transcript-area" contenteditable="false"></div>
            </div>
            <div class="rsc-notes-actions">
              <button class="rsc-copy-all-btn" title="全てコピー">📋 全てコピー</button>
            </div>
          </div>
        </div>

        <div class="rsc-modal-resize-handle"></div>
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
        z-index: 999999;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }
      #rsc-tools-modal.rsc-active {
        display: flex;
        align-items: flex-start;
        justify-content: center;
        padding-top: 10px;
      }
      .rsc-modal-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.5);
      }
      .rsc-modal-dialog {
        position: relative;
        background: #1a1a2e;
        border-radius: 12px;
        padding: 0;
        max-width: 600px;
        width: 90%;
        overflow: hidden;
        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
        resize: vertical;
        min-height: 200px;
        max-height: 90vh;
        display: flex;
        flex-direction: column;
      }
      .rsc-modal-resize-handle {
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        height: 12px;
        background: linear-gradient(to bottom, transparent, rgba(255,255,255,0.1));
        cursor: ns-resize;
        display: flex;
        justify-content: center;
        align-items: center;
      }
      .rsc-modal-resize-handle::after {
        content: '';
        width: 40px;
        height: 4px;
        background: rgba(255,255,255,0.3);
        border-radius: 2px;
      }
      .rsc-modal-resize-handle:hover::after {
        background: rgba(255,255,255,0.5);
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
        padding: 16px;
        padding-bottom: 24px;
        overflow-y: auto;
        flex: 1;
        min-height: 0;
      }
      .rsc-tab-content.active {
        display: flex;
        flex-direction: column;
      }

      /* カメラタブ */
      .rsc-camera-body {
        background: #000;
        border-radius: 12px;
        overflow: hidden;
        margin-bottom: 16px;
        aspect-ratio: 4 / 3;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      #rsc-camera-video {
        width: 100%;
        height: 100%;
        object-fit: cover;
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
      .rsc-recorder-top {
        display: flex;
        gap: 16px;
        margin-bottom: 16px;
      }
      .rsc-recorder-timer-section {
        flex: 1;
        min-width: 0;
      }
      .rsc-recorder-history-section {
        width: 240px;
        flex-shrink: 0;
        background: rgba(255,255,255,0.03);
        border-radius: 8px;
        padding: 8px;
        max-height: 160px;
        overflow-y: auto;
      }
      .rsc-recorder-history-title {
        color: #a0aec0;
        font-size: 12px;
        margin-bottom: 8px;
        font-weight: 500;
      }
      .rsc-recorder-history-section .rsc-recorder-recordings {
        margin-top: 0;
      }
      .rsc-recorder-history-section .rsc-recording-item {
        padding: 6px 8px;
        margin-bottom: 4px;
        font-size: 11px;
      }
      .rsc-recorder-history-section .rsc-recording-info {
        gap: 4px;
      }
      .rsc-recorder-history-section .rsc-recording-name {
        font-size: 11px;
      }
      .rsc-recorder-history-section .rsc-recording-meta {
        font-size: 10px;
      }
      .rsc-recorder-history-section .rsc-recording-actions {
        gap: 2px;
      }
      .rsc-recorder-history-section .rsc-recording-actions button {
        padding: 2px 4px;
        font-size: 12px;
      }
      .rsc-recorder-status {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        margin-bottom: 8px;
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
        font-size: 32px;
        font-weight: 300;
        color: #fff;
        font-variant-numeric: tabular-nums;
        margin-bottom: 12px;
      }
      .rsc-recorder-controls {
        display: flex;
        justify-content: center;
        gap: 12px;
        margin-bottom: 12px;
      }
      .rsc-recorder-btn {
        width: 44px;
        height: 44px;
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
      /* 文字起こし・メモエリア */
      .rsc-meeting-notes {
        margin-bottom: 16px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .rsc-notes-section {
        background: rgba(255,255,255,0.05);
        border-radius: 8px;
        padding: 12px;
      }
      .rsc-notes-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 8px;
      }
      .rsc-notes-title {
        color: #a0aec0;
        font-size: 13px;
        font-weight: 500;
      }
      .rsc-notes-toggle {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 11px;
        color: #718096;
        cursor: pointer;
      }
      .rsc-notes-toggle input {
        width: 14px;
        height: 14px;
        accent-color: #48bb78;
      }
      .rsc-transcript-area {
        background: rgba(0,0,0,0.2);
        border-radius: 6px;
        padding: 10px;
        min-height: 80px;
        max-height: 120px;
        overflow-y: auto;
        font-size: 13px;
        color: #e2e8f0;
        line-height: 1.5;
      }
      .rsc-transcript-area:empty::before {
        content: '録音を開始すると文字起こしが表示されます...';
        color: #4a5568;
      }
      .rsc-manual-notes {
        width: 100%;
        background: rgba(0,0,0,0.2);
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 6px;
        padding: 10px;
        min-height: 60px;
        font-size: 13px;
        color: #e2e8f0;
        resize: vertical;
        font-family: inherit;
      }
      .rsc-manual-notes:focus {
        outline: none;
        border-color: rgba(72, 187, 120, 0.5);
      }
      .rsc-manual-notes::placeholder {
        color: #4a5568;
      }
      .rsc-dev-badge {
        background: rgba(237, 137, 54, 0.2);
        color: #ed8936;
        font-size: 10px;
        padding: 2px 6px;
        border-radius: 4px;
        margin-left: 8px;
      }
      .rsc-structure-btn {
        background: rgba(72, 187, 120, 0.2);
        border: none;
        border-radius: 4px;
        padding: 4px 8px;
        font-size: 12px;
        cursor: pointer;
        color: #48bb78;
        margin-left: auto;
      }
      .rsc-structure-btn:hover {
        background: rgba(72, 187, 120, 0.3);
      }
      .rsc-structure-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .rsc-structure-btn.loading {
        animation: spin 1s linear infinite;
      }
      @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
      .rsc-structured-notes-area {
        background: rgba(0,0,0,0.2);
        border-radius: 6px;
        padding: 10px;
        min-height: 60px;
        font-size: 13px;
        color: #e2e8f0;
        line-height: 1.6;
        white-space: pre-wrap;
        font-family: monospace;
      }
      .rsc-structured-notes-area.placeholder {
        color: #718096;
        min-height: 40px;
      }
      .rsc-structure-controls {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .rsc-rate-limit-status {
        font-size: 11px;
        color: #a0aec0;
      }
      .rsc-rate-limit-status.waiting {
        color: #f6ad55;
      }
      .rsc-rate-limit-status.ready {
        color: #68d391;
      }
      .rsc-rate-limit-status .countdown {
        font-weight: bold;
        font-family: monospace;
      }
      .rsc-rate-limit-status .request-count {
        color: #718096;
        font-size: 10px;
      }
      .rsc-copy-btn {
        background: transparent;
        border: none;
        cursor: pointer;
        font-size: 14px;
        padding: 4px 6px;
        border-radius: 4px;
        opacity: 0.7;
        transition: all 0.2s;
      }
      .rsc-copy-btn:hover {
        opacity: 1;
        background: rgba(255,255,255,0.1);
      }
      .rsc-copy-btn.copied {
        color: #68d391;
      }
      .rsc-transcript-controls {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .rsc-notes-actions {
        display: flex;
        justify-content: flex-end;
        padding-top: 10px;
        border-top: 1px solid rgba(255,255,255,0.1);
        margin-top: 10px;
      }
      .rsc-copy-all-btn {
        background: rgba(99, 102, 241, 0.2);
        border: 1px solid rgba(99, 102, 241, 0.4);
        color: #a5b4fc;
        padding: 6px 12px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 12px;
        transition: all 0.2s;
      }
      .rsc-copy-all-btn:hover {
        background: rgba(99, 102, 241, 0.3);
      }
      .rsc-copy-all-btn.copied {
        background: rgba(72, 187, 120, 0.2);
        border-color: rgba(72, 187, 120, 0.4);
        color: #68d391;
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

    // 構造化ボタン
    const structureBtn = toolsModal.querySelector('.rsc-structure-btn');
    if (structureBtn) {
      structureBtn.addEventListener('click', async () => {
        if (!llmSettings) {
          try {
            const response = await chrome.runtime.sendMessage({ type: 'GET_LLM_SETTINGS' });
            if (response?.success && response.data) {
              llmSettings = response.data;
            }
          } catch (error) {
            console.warn('[HandSign] Failed to get LLM settings:', error);
          }
        }

        if (!llmSettings?.enabled || !llmSettings?.apiKey) {
          const structuredArea = toolsModal.querySelector('.rsc-structured-notes-area');
          if (structuredArea) {
            structuredArea.textContent = '⚠️ 拡張機能のポップアップ → AIタブでAPIキーを設定してください';
          }
          return;
        }

        await structureCurrentTranscript();
      });
    }

    // コピーボタン（個別）
    toolsModal.querySelectorAll('.rsc-copy-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const target = btn.dataset.target;
        let text = '';

        if (target === 'manual-notes') {
          text = toolsModal.querySelector('.rsc-manual-notes')?.value || '';
        } else if (target === 'structured-notes') {
          text = toolsModal.querySelector('.rsc-structured-notes-area')?.textContent || '';
        } else if (target === 'transcript') {
          text = toolsModal.querySelector('.rsc-transcript-area')?.textContent || '';
        }

        if (text && !text.startsWith('（')) {
          await copyToClipboard(text, btn);
        }
      });
    });

    // 全てコピーボタン
    const copyAllBtn = toolsModal.querySelector('.rsc-copy-all-btn');
    if (copyAllBtn) {
      copyAllBtn.addEventListener('click', async () => {
        const allText = getMeetingNotesText();
        if (allText.trim()) {
          await copyToClipboard(allText, copyAllBtn);
        }
      });
    }

    return toolsModal;
  }

  /**
   * クリップボードにコピー
   */
  async function copyToClipboard(text, btn) {
    try {
      await navigator.clipboard.writeText(text);

      // ボタンのフィードバック
      const originalText = btn.textContent;
      btn.textContent = '✅';
      btn.classList.add('copied');

      setTimeout(() => {
        btn.textContent = originalText;
        btn.classList.remove('copied');
      }, 1500);

      console.log('[HandSign] Copied to clipboard');
    } catch (error) {
      console.error('[HandSign] Failed to copy:', error);
    }
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
        video: {
          facingMode: 'user',
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
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
    if (!isExtensionContextValid()) {
      console.warn('[HandSign] Extension context invalidated');
      return;
    }
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
    if (!isExtensionContextValid()) {
      alert('拡張機能が更新されました。ページをリロードしてください。');
      return;
    }
    const result = await chrome.storage.local.get('virtualCameraImages');
    const images = result.virtualCameraImages || { wave: [], thumbsup: [] };

    if (!images[type] || index >= images[type].length) return;

    // 削除確認
    if (!confirm(`この画像を削除しますか？`)) return;

    // 画像を削除
    images[type].splice(index, 1);
    await chrome.storage.local.set({ virtualCameraImages: images });

    // virtual-camera.jsにリアルタイムで通知
    window.postMessage({
      source: 'remowork-virtual-camera',
      type: 'LOAD_IMAGES',
      payload: { images: images }
    }, '*');

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
    if (!isExtensionContextValid()) {
      alert('拡張機能が更新されました。ページをリロードしてください。');
      return;
    }
    const result = await chrome.storage.local.get('virtualCameraImages');
    const images = result.virtualCameraImages || { wave: [], thumbsup: [] };

    const count = images[type]?.length || 0;
    if (count === 0) return;

    const emoji = type === 'wave' ? '👋' : '👍';
    if (!confirm(`${emoji} の画像を全て削除しますか？（${count}枚）`)) return;

    // 全削除
    images[type] = [];
    await chrome.storage.local.set({ virtualCameraImages: images });

    // virtual-camera.jsにリアルタイムで通知
    window.postMessage({
      source: 'remowork-virtual-camera',
      type: 'LOAD_IMAGES',
      payload: { images: images }
    }, '*');

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

    // 録音タブを開く場合
    if (initialTab === 'recorder') {
      // 既に録音中ならUIを更新
      if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        updateRecorderUI(mediaRecorder.state === 'paused' ? 'paused' : 'recording');
        startRecorderTimer();
        showRecorderInfo('録音中（マイク）');
      }
      // 録音履歴を読み込み（古い録音の自動削除も実行）
      await loadRecordings();
    }

    // 保存された高さを復元
    restoreModalHeight();

    // リサイズハンドルを設定
    setupModalResize();
  }

  /**
   * モーダルの高さを復元
   */
  function restoreModalHeight() {
    if (!isExtensionContextValid()) {
      // デフォルト高さを設定
      const dialog = toolsModal?.querySelector('.rsc-modal-dialog');
      if (dialog) {
        dialog.style.height = '50vh';
      }
      return;
    }
    chrome.storage.local.get(['modalHeight'], (result) => {
      if (result.modalHeight) {
        const dialog = toolsModal?.querySelector('.rsc-modal-dialog');
        if (dialog) {
          dialog.style.height = result.modalHeight + 'px';
        }
      } else {
        // デフォルト高さ
        const dialog = toolsModal?.querySelector('.rsc-modal-dialog');
        if (dialog) {
          dialog.style.height = '50vh';
        }
      }
    });
  }

  /**
   * モーダルのリサイズ機能をセットアップ
   */
  function setupModalResize() {
    const dialog = toolsModal?.querySelector('.rsc-modal-dialog');
    const resizeHandle = toolsModal?.querySelector('.rsc-modal-resize-handle');

    if (!dialog || !resizeHandle) return;

    let isResizing = false;
    let startY = 0;
    let startHeight = 0;

    const onMouseDown = (e) => {
      isResizing = true;
      startY = e.clientY || e.touches?.[0]?.clientY;
      startHeight = dialog.offsetHeight;
      e.preventDefault();

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
      document.addEventListener('touchmove', onMouseMove);
      document.addEventListener('touchend', onMouseUp);
    };

    const onMouseMove = (e) => {
      if (!isResizing) return;

      const clientY = e.clientY || e.touches?.[0]?.clientY;
      const deltaY = clientY - startY;
      const newHeight = Math.max(200, Math.min(window.innerHeight * 0.9, startHeight + deltaY));

      dialog.style.height = newHeight + 'px';
    };

    const onMouseUp = () => {
      if (!isResizing) return;

      isResizing = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('touchmove', onMouseMove);
      document.removeEventListener('touchend', onMouseUp);

      // 高さを保存
      const currentHeight = dialog.offsetHeight;
      chrome.storage.local.set({ modalHeight: currentHeight });
    };

    resizeHandle.addEventListener('mousedown', onMouseDown);
    resizeHandle.addEventListener('touchstart', onMouseDown);
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
      if (!isExtensionContextValid()) {
        status.textContent = '拡張機能が更新されました。ページをリロードしてください';
        status.className = 'rsc-camera-status rsc-error';
        return;
      }

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

      // virtual-camera.jsにリアルタイムで画像を送信
      window.postMessage({
        source: 'remowork-virtual-camera',
        type: 'LOAD_IMAGES',
        payload: { images: images }
      }, '*');
      console.log('[HandSign] Sent LOAD_IMAGES to virtual-camera.js');

      // 成功をポップアップに通知
      if (isExtensionContextValid()) {
        chrome.runtime.sendMessage({
          type: 'CAMERA_CAPTURE_SUCCESS',
          imageType: type,
          count: images[type].length
        }).catch(() => {});
      }

    } catch (error) {
      console.error('[HandSign] Failed to save image:', error);
      if (error.message.includes('Extension context invalidated')) {
        status.textContent = '拡張機能が更新されました。ページをリロードしてください';
      } else {
        status.textContent = '保存に失敗しました';
      }
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

      // メモエリアを表示してクリア
      showMeetingNotesArea(true);
      clearMeetingNotes();

      // 文字起こしを開始
      startTranscription();

      // 自動構造化を開始
      startAutoStructure();

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

      // ストリームを保持するリスト
      const streamsToRelease = [];

      // マイク
      try {
        const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamsToRelease.push(micStream);
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

        streamsToRelease.push(displayStream);

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

      // ストリームを保持（停止時に解放するため）
      currentRecordingStream = { streams: streamsToRelease };

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
      stopTranscription();
      stopAutoStructure();
      releaseRecordingStream();
      updateRecorderUI('idle');
    }
  }

  /**
   * 文字起こしを開始（inject.js ページコンテキスト経由）
   * 注意: BraveブラウザではWeb Speech APIが利用不可（Chromeでは動作）
   */
  function startTranscription() {
    if (isTranscribing) return;

    updateTranscriptDisplay('文字起こしを開始しています...');
    transcriptText = '';

    // inject.js にイベントを送信
    window.dispatchEvent(new CustomEvent('remowork-transcription-start'));
    console.log('[HandSign] Transcription start requested');
  }

  /**
   * 文字起こしを停止（inject.js ページコンテキスト経由）
   */
  function stopTranscription() {
    if (!isTranscribing) return;

    // inject.js にイベントを送信
    window.dispatchEvent(new CustomEvent('remowork-transcription-stop'));
    isTranscribing = false;
    console.log('[HandSign] Transcription stop requested');
  }

  // inject.js からの文字起こしイベントをリッスン
  window.addEventListener('remowork-transcription-started', () => {
    isTranscribing = true;
    updateTranscriptDisplay('（音声を待機中...）');
    console.log('[HandSign] Transcription started');
  });

  window.addEventListener('remowork-transcription-result', (event) => {
    const { transcript, interim } = event.detail;
    transcriptText = transcript || '';
    const displayText = interim ? transcriptText + interim : transcriptText;
    updateTranscriptDisplay(displayText || '（音声を待機中...）');
  });

  window.addEventListener('remowork-transcription-error', (event) => {
    const { error, message } = event.detail;
    isTranscribing = false;

    if (error === 'network') {
      updateTranscriptDisplay(
        '⚠️ ネットワークエラー\n\n' +
        'Braveブラウザでは利用できません。\n' +
        'Google Chromeをお使いください。'
      );
    } else if (error === 'not-allowed') {
      updateTranscriptDisplay('⚠️ マイクへのアクセスが拒否されました');
    } else {
      updateTranscriptDisplay(`⚠️ エラー: ${message || error}`);
    }
  });

  window.addEventListener('remowork-transcription-stopped', (event) => {
    if (event.detail?.transcript) {
      transcriptText = event.detail.transcript;
    }
    console.log('[HandSign] Transcription stopped');
  });

  /**
   * 文字起こし表示を更新
   */
  function updateTranscriptDisplay(text) {
    const transcriptArea = toolsModal?.querySelector('.rsc-transcript-area');
    if (transcriptArea) {
      transcriptArea.textContent = text;
      transcriptArea.scrollTop = transcriptArea.scrollHeight;
    }
  }

  /**
   * メモエリアを表示/非表示
   */
  function showMeetingNotesArea(show) {
    const notesArea = toolsModal?.querySelector('.rsc-meeting-notes');
    if (notesArea) {
      notesArea.style.display = show ? 'flex' : 'none';
    }
  }

  /**
   * メモをクリア
   */
  function clearMeetingNotes() {
    transcriptText = '';
    lastStructuredText = '';
    const transcriptArea = toolsModal?.querySelector('.rsc-transcript-area');
    const manualNotes = toolsModal?.querySelector('.rsc-manual-notes');
    const structuredArea = toolsModal?.querySelector('.rsc-structured-notes-area');
    if (transcriptArea) transcriptArea.textContent = '';
    if (manualNotes) manualNotes.value = '';
    if (structuredArea) {
      structuredArea.textContent = '（AIタブで設定後、録音中に自動構造化されます）';
      structuredArea.classList.add('placeholder');
    }
  }

  /**
   * レート制限をチェック（リクエスト可能か判定）
   */
  function canMakeRequest() {
    const provider = llmSettings?.provider || 'gemini';
    const limits = RATE_LIMIT[provider] || RATE_LIMIT.gemini;
    const now = Date.now();

    // 1分経過していたらリセット
    if (now - lastMinuteReset > 60000) {
      requestCountMinute = 0;
      lastMinuteReset = now;
    }

    // RPMチェック
    if (requestCountMinute >= limits.rpm) {
      return { allowed: false, reason: 'rpm', waitMs: 60000 - (now - lastMinuteReset) };
    }

    // RPDチェック（Geminiのみ厳密に管理）
    if (provider === 'gemini' && requestCountToday >= limits.rpd) {
      return { allowed: false, reason: 'rpd', waitMs: 0 };
    }

    // 最小間隔チェック
    const elapsed = now - lastRequestTime;
    if (elapsed < limits.minInterval) {
      return { allowed: false, reason: 'interval', waitMs: limits.minInterval - elapsed };
    }

    return { allowed: true };
  }

  /**
   * リクエスト送信を記録
   */
  function recordRequest() {
    lastRequestTime = Date.now();
    requestCountMinute++;
    requestCountToday++;
    updateRateLimitUI();
  }

  /**
   * レート制限UIを更新
   */
  function updateRateLimitUI() {
    const provider = llmSettings?.provider || 'gemini';
    const limits = RATE_LIMIT[provider] || RATE_LIMIT.gemini;
    const statusEl = toolsModal?.querySelector('.rsc-rate-limit-status');

    if (!statusEl) return;

    const now = Date.now();
    const nextAvailable = lastRequestTime + limits.minInterval;
    const remaining = Math.max(0, nextAvailable - now);

    if (remaining > 0) {
      statusEl.innerHTML = `⏳ 次の送信まで: <span class="countdown">${Math.ceil(remaining / 1000)}秒</span>`;
      statusEl.className = 'rsc-rate-limit-status waiting';
    } else {
      statusEl.innerHTML = `✅ 送信可能 <span class="request-count">(本日: ${requestCountToday}/${limits.rpd})</span>`;
      statusEl.className = 'rsc-rate-limit-status ready';
    }
  }

  /**
   * カウントダウンタイマーを開始
   */
  function startCountdownTimer() {
    if (nextRequestCountdown) {
      clearInterval(nextRequestCountdown);
    }
    nextRequestCountdown = setInterval(() => {
      updateRateLimitUI();
    }, 1000);
  }

  /**
   * カウントダウンタイマーを停止
   */
  function stopCountdownTimer() {
    if (nextRequestCountdown) {
      clearInterval(nextRequestCountdown);
      nextRequestCountdown = null;
    }
  }

  /**
   * 自動構造化を開始
   */
  async function startAutoStructure() {
    // LLM設定を取得
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_LLM_SETTINGS' });
      if (response?.success && response.data) {
        llmSettings = response.data;
      }
    } catch (error) {
      console.warn('[HandSign] Failed to get LLM settings:', error);
    }

    if (!llmSettings?.enabled || !llmSettings?.apiKey) {
      console.log('[HandSign] Auto structure disabled or no API key');
      return;
    }

    if (!llmSettings.autoStructure) {
      console.log('[HandSign] Auto structure is off');
      return;
    }

    // カウントダウンタイマー開始
    startCountdownTimer();

    // 30秒ごとに構造化（レート制限を考慮）
    structureInterval = setInterval(async () => {
      const rateCheck = canMakeRequest();
      if (!rateCheck.allowed) {
        console.log(`[HandSign] Rate limited (${rateCheck.reason}), waiting ${Math.ceil(rateCheck.waitMs / 1000)}s`);
        return;
      }
      if (transcriptText && transcriptText !== lastStructuredText && transcriptText.length > 50) {
        await structureCurrentTranscript();
      }
    }, 30000);

    console.log('[HandSign] Auto structure started');
  }

  /**
   * 自動構造化を停止
   */
  function stopAutoStructure() {
    if (structureInterval) {
      clearInterval(structureInterval);
      structureInterval = null;
    }
    stopCountdownTimer();
    console.log('[HandSign] Auto structure stopped');
  }

  /**
   * 現在の文字起こしを構造化
   */
  async function structureCurrentTranscript() {
    // レート制限チェック（手動ボタン押下時）
    const rateCheck = canMakeRequest();
    if (!rateCheck.allowed) {
      const structuredArea = toolsModal?.querySelector('.rsc-structured-notes-area');
      if (structuredArea) {
        if (rateCheck.reason === 'rpd') {
          structuredArea.textContent = '本日のリクエスト上限に達しました';
        } else {
          structuredArea.textContent = `⏳ ${Math.ceil(rateCheck.waitMs / 1000)}秒後に再試行してください`;
        }
      }
      return;
    }

    const manualNotes = toolsModal?.querySelector('.rsc-manual-notes')?.value || '';
    const hasTranscript = transcriptText && transcriptText.trim().length > 0;
    const hasNotes = manualNotes.trim().length > 0;

    if (!hasTranscript && !hasNotes) {
      const structuredArea = toolsModal?.querySelector('.rsc-structured-notes-area');
      if (structuredArea) {
        structuredArea.textContent = '（文字起こしまたはメモを入力してください）';
      }
      return;
    }

    // 文字起こしとメモを結合
    let combinedInput = '';
    if (hasTranscript) {
      combinedInput += '【文字起こし】\n' + transcriptText.trim() + '\n\n';
    }
    if (hasNotes) {
      combinedInput += '【手動メモ】\n' + manualNotes.trim();
    }

    const structuredArea = toolsModal?.querySelector('.rsc-structured-notes-area');
    const structureBtn = toolsModal?.querySelector('.rsc-structure-btn');

    if (structureBtn) {
      structureBtn.classList.add('loading');
      structureBtn.disabled = true;
    }

    // リクエスト送信を記録
    recordRequest();

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'STRUCTURE_TRANSCRIPT',
        transcript: combinedInput,
        settings: llmSettings
      });

      if (response?.success && response.structured) {
        lastStructuredText = transcriptText;
        if (structuredArea) {
          structuredArea.textContent = response.structured;
          structuredArea.classList.remove('placeholder');
          structuredArea.scrollTop = structuredArea.scrollHeight;
        }
        console.log('[HandSign] Transcript structured');
      } else {
        console.warn('[HandSign] Structure failed:', response?.error);
        if (structuredArea && response?.error) {
          structuredArea.textContent = `エラー: ${response.error}`;
        }
      }
    } catch (error) {
      console.error('[HandSign] Structure error:', error);
    } finally {
      if (structureBtn) {
        structureBtn.classList.remove('loading');
        structureBtn.disabled = false;
      }
    }
  }

  /**
   * 現在のメモを取得（構造化メモ含む）
   */
  function getMeetingNotesText() {
    const manualNotes = toolsModal?.querySelector('.rsc-manual-notes')?.value || '';
    const structuredNotes = toolsModal?.querySelector('.rsc-structured-notes-area')?.textContent || '';
    let text = '';

    // 構造化メモ（AIによる要約）を先頭に
    if (structuredNotes.trim() && !structuredNotes.startsWith('（')) {
      text += '【自動構造化メモ】\n' + structuredNotes.trim() + '\n\n';
    }

    // 手動メモ
    if (manualNotes.trim()) {
      text += '【メモ】\n' + manualNotes.trim() + '\n\n';
    }

    // 文字起こし
    if (transcriptText.trim()) {
      text += '【文字起こし】\n' + transcriptText.trim() + '\n';
    }

    return text;
  }

  /**
   * 録音用IndexedDBを初期化
   */
  async function initRecordingsDb() {
    if (recordingsDb) return recordingsDb;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(RECORDINGS_DB_NAME, 1);

      request.onerror = () => {
        console.error('[HandSign] Failed to open recordings DB:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        recordingsDb = request.result;
        console.log('[HandSign] Recordings DB opened');
        resolve(recordingsDb);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(RECORDINGS_STORE_NAME)) {
          const store = db.createObjectStore(RECORDINGS_STORE_NAME, { keyPath: 'id' });
          store.createIndex('date', 'date', { unique: false });
          console.log('[HandSign] Recordings store created');
        }
      };
    });
  }

  /**
   * 録音データをIndexedDBに保存
   */
  async function saveRecordingToDb(recording) {
    try {
      const db = await initRecordingsDb();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction([RECORDINGS_STORE_NAME], 'readwrite');
        const store = transaction.objectStore(RECORDINGS_STORE_NAME);
        const request = store.put(recording);

        request.onsuccess = () => {
          console.log('[HandSign] Recording saved to DB:', recording.id);
          resolve();
        };
        request.onerror = () => {
          console.error('[HandSign] Failed to save recording:', request.error);
          reject(request.error);
        };
      });
    } catch (e) {
      console.error('[HandSign] DB error:', e);
    }
  }

  /**
   * 録音データをIndexedDBから読み込み
   */
  async function loadRecordingsFromDb() {
    try {
      const db = await initRecordingsDb();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction([RECORDINGS_STORE_NAME], 'readonly');
        const store = transaction.objectStore(RECORDINGS_STORE_NAME);
        const request = store.getAll();

        request.onsuccess = () => {
          const data = request.result || [];
          // 新しい順にソート
          data.sort((a, b) => b.id - a.id);
          console.log('[HandSign] Loaded recordings from DB:', data.length);
          resolve(data);
        };
        request.onerror = () => {
          console.error('[HandSign] Failed to load recordings:', request.error);
          reject(request.error);
        };
      });
    } catch (e) {
      console.error('[HandSign] DB error:', e);
      return [];
    }
  }

  /**
   * 録音データをIndexedDBから削除
   */
  async function deleteRecordingFromDb(id) {
    try {
      const db = await initRecordingsDb();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction([RECORDINGS_STORE_NAME], 'readwrite');
        const store = transaction.objectStore(RECORDINGS_STORE_NAME);
        const request = store.delete(id);

        request.onsuccess = () => {
          console.log('[HandSign] Recording deleted from DB:', id);
          resolve();
        };
        request.onerror = () => {
          console.error('[HandSign] Failed to delete recording:', request.error);
          reject(request.error);
        };
      });
    } catch (e) {
      console.error('[HandSign] DB error:', e);
    }
  }

  /**
   * 録音データを保存
   */
  async function saveRecordingData(blob) {
    const now = new Date();
    const dateStr = now.toLocaleString('ja-JP', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
    const notesText = getMeetingNotesText();

    const recording = {
      id: Date.now(),
      name: dateStr,
      blob: blob,
      duration: formatRecorderTime(Date.now() - recordingStartTime),
      date: now.toLocaleString('ja-JP'),
      notes: notesText // メモを保存
    };

    recordings.unshift(recording);
    updateRecordingsList();

    // IndexedDBに保存
    await saveRecordingToDb(recording);
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
      const hasNotes = recording.notes && recording.notes.trim();
      html += `
        <div class="rsc-recording-item" data-id="${recording.id}">
          <div class="rsc-recording-info">
            <span class="rsc-recording-name">${recording.name}</span>
            <span class="rsc-recording-meta">${recording.duration}${hasNotes ? ' 📝' : ''}</span>
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
            <button class="rsc-recording-btn rsc-recording-download" data-id="${recording.id}" title="音声ダウンロード">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
              </svg>
            </button>
            ${hasNotes ? `
            <button class="rsc-recording-btn rsc-recording-notes-download" data-id="${recording.id}" title="メモダウンロード">📄</button>
            <button class="rsc-recording-btn rsc-recording-notes-copy" data-id="${recording.id}" title="メモコピー">📋</button>
            ` : ''}
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
    container.querySelectorAll('.rsc-recording-notes-download').forEach(btn => {
      btn.addEventListener('click', () => downloadNotesById(parseInt(btn.dataset.id)));
    });
    container.querySelectorAll('.rsc-recording-notes-copy').forEach(btn => {
      btn.addEventListener('click', () => copyNotesById(parseInt(btn.dataset.id)));
    });
    container.querySelectorAll('.rsc-recording-delete').forEach(btn => {
      btn.addEventListener('click', () => deleteRecordingById(parseInt(btn.dataset.id)));
    });
  }

  /**
   * メモをダウンロード
   */
  function downloadNotesById(id) {
    const recording = recordings.find(r => r.id === id);
    if (!recording || !recording.notes) return;

    const blob = new Blob([recording.notes], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${recording.name}_notes.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /**
   * メモをクリップボードにコピー
   */
  async function copyNotesById(id) {
    const recording = recordings.find(r => r.id === id);
    if (!recording || !recording.notes) return;

    try {
      await navigator.clipboard.writeText(recording.notes);
      showTimerToast('メモをコピーしました');
    } catch (e) {
      console.error('[HandSign] Failed to copy notes:', e);
      showTimerToast('コピーに失敗しました');
    }
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
  async function deleteRecordingById(id) {
    const index = recordings.findIndex(r => r.id === id);
    if (index === -1) return;

    const recording = recordings[index];
    if (!confirm(`「${recording.name}」を削除しますか？`)) return;

    if (currentPlayingId === id) {
      stopPlaybackAudio();
    }

    recordings.splice(index, 1);
    updateRecordingsList();

    // IndexedDBからも削除
    await deleteRecordingFromDb(id);
  }

  /**
   * 1ヶ月以上経過した録音を自動削除
   */
  async function cleanupOldRecordings() {
    const oneMonthAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    const oldRecordings = recordings.filter(r => r.id < oneMonthAgo);

    if (oldRecordings.length === 0) return;

    console.log(`[HandSign] Cleaning up ${oldRecordings.length} old recordings...`);

    for (const recording of oldRecordings) {
      await deleteRecordingFromDb(recording.id);
    }

    recordings = recordings.filter(r => r.id >= oneMonthAgo);
    updateRecordingsList();
    console.log('[HandSign] Old recordings cleaned up');
  }

  /**
   * 録音履歴を読み込み
   */
  async function loadRecordings() {
    try {
      recordings = await loadRecordingsFromDb();
      updateRecordingsList();
      // 古い録音を自動削除
      await cleanupOldRecordings();
    } catch (e) {
      console.error('[HandSign] Failed to load recordings:', e);
    }
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

  // ===== 音声設定モーダル =====

  let soundSettingsModal = null;
  let presetSounds = null;
  let soundSettings = null;

  const SOUND_LABELS = {
    calling: '発信中（呼び出し音）',
    incoming: '着信音',
    outgoing: '発信音',
    disconnect: '切断音',
    doorchime: 'ドアチャイム'
  };

  /**
   * 音声設定モーダルを作成
   */
  function createSoundSettingsModal() {
    if (soundSettingsModal) return soundSettingsModal;

    soundSettingsModal = document.createElement('div');
    soundSettingsModal.id = 'rsc-sound-settings-modal';
    soundSettingsModal.innerHTML = `
      <div class="rsc-modal-overlay"></div>
      <div class="rsc-modal-dialog rsc-sound-dialog">
        <div class="rsc-modal-header">
          <div class="rsc-modal-title">🔊 音声設定</div>
          <button class="rsc-modal-close">×</button>
        </div>
        <div class="rsc-sound-settings-content">
          <div class="rsc-sound-loading">読み込み中...</div>
        </div>
      </div>
    `;

    // スタイルを追加
    if (!document.getElementById('rsc-sound-settings-styles')) {
      const style = document.createElement('style');
      style.id = 'rsc-sound-settings-styles';
      style.textContent = `
        #rsc-sound-settings-modal {
          display: none;
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          z-index: 999999;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }
        #rsc-sound-settings-modal.rsc-active {
          display: flex;
          align-items: center;
          justify-content: center;
        }
        #rsc-sound-settings-modal .rsc-modal-overlay {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: rgba(0, 0, 0, 0.7);
        }
        #rsc-sound-settings-modal .rsc-modal-dialog {
          position: relative;
          background: #1a1a2e;
          border-radius: 16px;
          padding: 0;
          max-width: 600px;
          width: 95%;
          max-height: 95vh;
          overflow: hidden;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
        }
        #rsc-sound-settings-modal .rsc-modal-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 16px 20px;
          border-bottom: 1px solid rgba(255,255,255,0.1);
          background: linear-gradient(135deg, #2d3748 0%, #1a202c 100%);
        }
        #rsc-sound-settings-modal .rsc-modal-title {
          color: #fff;
          font-size: 16px;
          font-weight: 500;
        }
        #rsc-sound-settings-modal .rsc-modal-close {
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
        #rsc-sound-settings-modal .rsc-modal-close:hover {
          color: #fff;
          background: rgba(255,255,255,0.1);
        }
        .rsc-sound-settings-content {
          padding: 20px;
          max-height: calc(95vh - 70px);
          overflow-y: auto;
        }
        .rsc-sound-loading {
          text-align: center;
          color: #a0aec0;
          padding: 40px;
        }
        .rsc-sound-item {
          background: rgba(255,255,255,0.05);
          border-radius: 10px;
          padding: 16px;
          margin-bottom: 12px;
        }
        .rsc-sound-item:last-child {
          margin-bottom: 0;
        }
        .rsc-sound-item-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 12px;
        }
        .rsc-sound-item-label {
          color: #fff;
          font-size: 14px;
          font-weight: 500;
        }
        .rsc-sound-item-mode {
          color: #a0aec0;
          font-size: 12px;
          padding: 4px 8px;
          background: rgba(255,255,255,0.1);
          border-radius: 4px;
        }
        .rsc-sound-select-row {
          display: flex;
          gap: 8px;
          align-items: center;
        }
        .rsc-sound-select {
          flex: 1;
          padding: 10px 12px;
          border: 1px solid rgba(255,255,255,0.2);
          border-radius: 8px;
          background: rgba(255,255,255,0.1);
          color: #fff;
          font-size: 14px;
          cursor: pointer;
          appearance: none;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23a0aec0' d='M6 8L1 3h10z'/%3E%3C/svg%3E");
          background-repeat: no-repeat;
          background-position: right 12px center;
        }
        .rsc-sound-select:focus {
          outline: none;
          border-color: #667eea;
        }
        .rsc-sound-select option {
          background: #1a1a2e;
          color: #fff;
        }
        .rsc-sound-play-btn {
          width: 40px;
          height: 40px;
          border: none;
          border-radius: 8px;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: #fff;
          font-size: 16px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s;
        }
        .rsc-sound-play-btn:hover {
          transform: scale(1.05);
        }
        .rsc-sound-play-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .rsc-sound-upload-btn {
          width: 40px;
          height: 40px;
          border: none;
          border-radius: 8px;
          background: #6b7280;
          color: #fff;
          font-size: 16px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s;
        }
        .rsc-sound-upload-btn:hover {
          background: #4b5563;
          transform: scale(1.05);
        }
        .rsc-sound-custom-info {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-top: 8px;
          padding: 8px 12px;
          background: rgba(74, 222, 128, 0.1);
          border: 1px solid rgba(74, 222, 128, 0.3);
          border-radius: 6px;
          font-size: 13px;
        }
        .rsc-sound-custom-name {
          flex: 1;
          color: #4ade80;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .rsc-sound-custom-delete {
          background: none;
          border: none;
          color: #ef4444;
          font-size: 14px;
          cursor: pointer;
          padding: 2px 6px;
        }
        .rsc-sound-custom-delete:hover {
          color: #f87171;
        }
        .rsc-sound-notification {
          margin-top: 20px;
          padding-top: 20px;
          border-top: 1px solid rgba(255,255,255,0.1);
        }
        .rsc-sound-notification-title {
          color: #fff;
          font-size: 14px;
          font-weight: 500;
          margin-bottom: 12px;
        }
      `;
      document.head.appendChild(style);
    }

    document.body.appendChild(soundSettingsModal);

    // イベント設定
    soundSettingsModal.querySelector('.rsc-modal-overlay').addEventListener('click', closeSoundSettingsModal);
    soundSettingsModal.querySelector('.rsc-modal-close').addEventListener('click', closeSoundSettingsModal);

    return soundSettingsModal;
  }

  /**
   * 音声設定モーダルを開く
   * @param {boolean} scrollToNotification - 通知音設定にスクロールするかどうか
   */
  async function openSoundSettingsModal(scrollToNotification = false) {
    createSoundSettingsModal();
    soundSettingsModal.classList.add('rsc-active');

    // データを読み込み
    await loadSoundSettingsData();
    renderSoundSettings();

    // 通知音設定にスクロール
    if (scrollToNotification) {
      setTimeout(() => {
        const notificationSection = soundSettingsModal.querySelector('.rsc-sound-notification');
        if (notificationSection) {
          notificationSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
          // ハイライト効果
          notificationSection.style.transition = 'background-color 0.3s';
          notificationSection.style.backgroundColor = 'rgba(74, 144, 217, 0.2)';
          setTimeout(() => {
            notificationSection.style.backgroundColor = '';
          }, 1500);
        }
      }, 100);
    }
  }

  /**
   * 音声設定モーダルを閉じる
   */
  function closeSoundSettingsModal() {
    if (soundSettingsModal) {
      soundSettingsModal.classList.remove('rsc-active');
    }
  }

  // ===== ハンドサイン設定モーダル =====
  let handSignSettingsModal = null;

  /**
   * ハンドサイン設定モーダルを作成
   */
  function createHandSignSettingsModal() {
    if (handSignSettingsModal) return handSignSettingsModal;

    handSignSettingsModal = document.createElement('div');
    handSignSettingsModal.id = 'rsc-handsign-settings-modal';
    handSignSettingsModal.innerHTML = `
      <style>
        #rsc-handsign-settings-modal {
          display: none;
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          z-index: 100002;
        }
        #rsc-handsign-settings-modal.rsc-active {
          display: block;
        }
        #rsc-handsign-settings-modal .rsc-modal-overlay {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0,0,0,0.5);
        }
        #rsc-handsign-settings-modal .rsc-modal-dialog {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          background: #1e1e1e;
          border-radius: 12px;
          width: 400px;
          max-height: 80vh;
          overflow: hidden;
          box-shadow: 0 8px 32px rgba(0,0,0,0.5);
        }
        #rsc-handsign-settings-modal .rsc-modal-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 16px;
          border-bottom: 1px solid #333;
        }
        #rsc-handsign-settings-modal .rsc-modal-title {
          font-size: 16px;
          font-weight: 600;
          color: #fff;
        }
        #rsc-handsign-settings-modal .rsc-modal-close {
          background: none;
          border: none;
          color: #888;
          font-size: 24px;
          cursor: pointer;
          padding: 0;
          line-height: 1;
        }
        #rsc-handsign-settings-modal .rsc-modal-close:hover {
          color: #fff;
        }
        #rsc-handsign-settings-modal .rsc-modal-body {
          padding: 16px;
          overflow-y: auto;
          max-height: calc(80vh - 60px);
          color: #e0e0e0;
        }
        .rsc-hs-section {
          margin-bottom: 16px;
          padding-bottom: 16px;
          border-bottom: 1px solid #333;
        }
        .rsc-hs-section:last-child {
          border-bottom: none;
          margin-bottom: 0;
        }
        .rsc-hs-label {
          font-size: 13px;
          font-weight: 500;
          color: #a0a0a0;
          margin-bottom: 8px;
        }
        .rsc-hs-toggle {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .rsc-hs-toggle-switch {
          position: relative;
          width: 44px;
          height: 24px;
        }
        .rsc-hs-toggle-switch input {
          opacity: 0;
          width: 0;
          height: 0;
        }
        .rsc-hs-toggle-slider {
          position: absolute;
          cursor: pointer;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background-color: #555;
          transition: 0.3s;
          border-radius: 24px;
        }
        .rsc-hs-toggle-slider:before {
          position: absolute;
          content: "";
          height: 18px;
          width: 18px;
          left: 3px;
          bottom: 3px;
          background-color: white;
          transition: 0.3s;
          border-radius: 50%;
        }
        .rsc-hs-toggle-switch input:checked + .rsc-hs-toggle-slider {
          background-color: #4a90d9;
        }
        .rsc-hs-toggle-switch input:checked + .rsc-hs-toggle-slider:before {
          transform: translateX(20px);
        }
        .rsc-hs-input {
          width: 100%;
          padding: 10px 12px;
          border: 1px solid #444;
          border-radius: 6px;
          background: #2d2d2d;
          color: #fff;
          font-size: 14px;
        }
        .rsc-hs-input:focus {
          outline: none;
          border-color: #4a90d9;
        }
        .rsc-hs-sound-row {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .rsc-hs-sound-select {
          flex: 1;
          padding: 10px 12px;
          border: 1px solid #444;
          border-radius: 6px;
          background: #2d2d2d;
          color: #fff;
          font-size: 14px;
        }
        .rsc-hs-sound-select option,
        .rsc-hs-sound-select optgroup {
          background: #2d2d2d;
          color: #fff;
        }
        .rsc-hs-sound-btn {
          width: 36px;
          height: 36px;
          border: none;
          border-radius: 6px;
          background: #4a90d9;
          color: #fff;
          font-size: 14px;
          cursor: pointer;
        }
        .rsc-hs-sound-btn:hover {
          background: #3a7bc8;
        }
        .rsc-hs-upload-btn {
          background: #6b7280;
        }
        .rsc-hs-upload-btn:hover {
          background: #4b5563;
        }
        .rsc-hs-custom-info {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-top: 8px;
          padding: 8px 12px;
          background: #3d3d3d;
          border-radius: 6px;
          font-size: 13px;
        }
        .rsc-hs-custom-name {
          flex: 1;
          color: #4ade80;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .rsc-hs-custom-delete {
          background: none;
          border: none;
          color: #ef4444;
          font-size: 14px;
          cursor: pointer;
          padding: 2px 6px;
        }
        .rsc-hs-custom-delete:hover {
          color: #f87171;
        }
        .rsc-hs-test-btn {
          width: 100%;
          padding: 10px;
          border: none;
          border-radius: 6px;
          background: linear-gradient(135deg, #48bb78 0%, #38a169 100%);
          color: #fff;
          font-size: 14px;
          cursor: pointer;
          margin-top: 12px;
        }
        .rsc-hs-test-btn:hover {
          background: linear-gradient(135deg, #68d391 0%, #48bb78 100%);
        }
      </style>
      <div class="rsc-modal-overlay"></div>
      <div class="rsc-modal-dialog">
        <div class="rsc-modal-header">
          <span class="rsc-modal-title">🔔 通知設定</span>
          <button class="rsc-modal-close">&times;</button>
        </div>
        <div class="rsc-modal-body">
          <div class="rsc-hs-section">
            <div class="rsc-hs-label">ハンドサイン検出</div>
            <div class="rsc-hs-toggle">
              <label class="rsc-hs-toggle-switch">
                <input type="checkbox" id="rsc-hs-enabled">
                <span class="rsc-hs-toggle-slider"></span>
              </label>
              <span>他のメンバーの手を検出して通知</span>
            </div>
          </div>
          <div class="rsc-hs-section">
            <div class="rsc-hs-label">自分の名前（検出から除外）</div>
            <input type="text" class="rsc-hs-input" id="rsc-hs-myname" placeholder="例: 松川 幸平">
          </div>
          <div class="rsc-hs-section">
            <div class="rsc-hs-label">通知音</div>
            <div class="rsc-hs-sound-row">
              <select class="rsc-hs-sound-select" id="rsc-hs-sound"></select>
              <button class="rsc-hs-sound-btn" id="rsc-hs-sound-play" title="試聴">▶</button>
              <button class="rsc-hs-sound-btn rsc-hs-upload-btn" id="rsc-hs-sound-upload" title="カスタム音声をアップロード">📁</button>
              <input type="file" id="rsc-hs-sound-file" accept="audio/*" style="display:none;">
            </div>
            <div class="rsc-hs-custom-info" id="rsc-hs-custom-info" style="display:none;">
              <span class="rsc-hs-custom-name"></span>
              <button class="rsc-hs-custom-delete" title="削除">✕</button>
            </div>
          </div>
          <button class="rsc-hs-test-btn" id="rsc-hs-test">🔔 通知テスト</button>
        </div>
      </div>
    `;

    document.body.appendChild(handSignSettingsModal);

    // イベントハンドラ
    handSignSettingsModal.querySelector('.rsc-modal-overlay').addEventListener('click', closeHandSignSettingsModal);
    handSignSettingsModal.querySelector('.rsc-modal-close').addEventListener('click', closeHandSignSettingsModal);

    // 有効/無効トグル
    handSignSettingsModal.querySelector('#rsc-hs-enabled').addEventListener('change', async (e) => {
      settings.enabled = e.target.checked;
      await saveHandSignSettings();
    });

    // 自分の名前
    handSignSettingsModal.querySelector('#rsc-hs-myname').addEventListener('change', async (e) => {
      settings.myName = e.target.value;
      await saveHandSignSettings();
    });

    // 通知音変更
    handSignSettingsModal.querySelector('#rsc-hs-sound').addEventListener('change', async (e) => {
      if (!settings.notifications) settings.notifications = {};
      settings.notifications.soundPreset = e.target.value;
      await saveHandSignSettings();
    });

    // 試聴ボタン
    handSignSettingsModal.querySelector('#rsc-hs-sound-play').addEventListener('click', () => {
      const soundPreset = handSignSettingsModal.querySelector('#rsc-hs-sound').value;
      chrome.runtime.sendMessage({
        type: 'PLAY_HAND_SIGN_SOUND',
        preset: soundPreset
      });
    });

    // テストボタン
    handSignSettingsModal.querySelector('#rsc-hs-test').addEventListener('click', () => {
      testNotification();
    });

    // アップロードボタン
    handSignSettingsModal.querySelector('#rsc-hs-sound-upload').addEventListener('click', () => {
      handSignSettingsModal.querySelector('#rsc-hs-sound-file').click();
    });

    // ファイル選択
    handSignSettingsModal.querySelector('#rsc-hs-sound-file').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      // ファイルサイズチェック（10MB制限）
      if (file.size > 10 * 1024 * 1024) {
        showTimerToast('ファイルサイズは10MB以下にしてください');
        return;
      }

      try {
        const reader = new FileReader();
        reader.onload = async (event) => {
          const base64Data = event.target.result;

          // カスタム音声を保存
          await chrome.runtime.sendMessage({
            type: 'SAVE_NOTIFICATION_CUSTOM_SOUND',
            data: base64Data,
            fileName: file.name,
            mimeType: file.type
          });

          // 設定を更新
          if (!settings.notifications) settings.notifications = {};
          settings.notifications.soundPreset = 'custom';
          settings.notifications.customFileName = file.name;
          await saveHandSignSettings();

          // UI更新
          updateCustomSoundInfo(file.name);
          showTimerToast('カスタム音声を設定しました');
        };
        reader.readAsDataURL(file);
      } catch (error) {
        console.error('[HandSign] Failed to upload custom sound:', error);
        showTimerToast('アップロードに失敗しました');
      }

      // ファイル入力をリセット
      e.target.value = '';
    });

    // カスタム音声削除ボタン
    handSignSettingsModal.querySelector('.rsc-hs-custom-delete').addEventListener('click', async () => {
      try {
        await chrome.runtime.sendMessage({ type: 'DELETE_NOTIFICATION_CUSTOM_SOUND' });

        if (!settings.notifications) settings.notifications = {};
        settings.notifications.soundPreset = 'outgoing:outgoing_horn';
        settings.notifications.customFileName = null;
        await saveHandSignSettings();

        // UI更新
        updateCustomSoundInfo(null);
        handSignSettingsModal.querySelector('#rsc-hs-sound').value = 'outgoing:outgoing_horn';
        showTimerToast('カスタム音声を削除しました');
      } catch (error) {
        console.error('[HandSign] Failed to delete custom sound:', error);
      }
    });

    return handSignSettingsModal;
  }

  /**
   * カスタム音声情報の表示を更新
   */
  function updateCustomSoundInfo(fileName) {
    const customInfo = handSignSettingsModal?.querySelector('#rsc-hs-custom-info');
    const customName = handSignSettingsModal?.querySelector('.rsc-hs-custom-name');
    const soundSelect = handSignSettingsModal?.querySelector('#rsc-hs-sound');

    if (!customInfo) return;

    if (fileName) {
      customInfo.style.display = 'flex';
      customName.textContent = `🎵 ${fileName}`;
      // プルダウンを無効化してカスタムを示す
      if (soundSelect) {
        // カスタムオプションを追加または選択
        let customOption = soundSelect.querySelector('option[value="custom"]');
        if (!customOption) {
          customOption = document.createElement('option');
          customOption.value = 'custom';
          customOption.textContent = '🎵 カスタム音声';
          soundSelect.insertBefore(customOption, soundSelect.firstChild);
        }
        soundSelect.value = 'custom';
      }
    } else {
      customInfo.style.display = 'none';
      // カスタムオプションを削除
      const customOption = soundSelect?.querySelector('option[value="custom"]');
      if (customOption) {
        customOption.remove();
      }
    }
  }

  /**
   * ハンドサイン設定モーダルを開く
   */
  async function openHandSignSettingsModal() {
    createHandSignSettingsModal();
    handSignSettingsModal.classList.add('rsc-active');

    // 現在の設定を反映
    handSignSettingsModal.querySelector('#rsc-hs-enabled').checked = settings.enabled || false;
    handSignSettingsModal.querySelector('#rsc-hs-myname').value = settings.myName || '';

    // 通知音のプリセットを読み込み
    const soundSelect = handSignSettingsModal.querySelector('#rsc-hs-sound');
    soundSelect.innerHTML = '';

    try {
      const presetsResponse = await chrome.runtime.sendMessage({ type: 'GET_PRESET_SOUNDS' });
      if (presetsResponse && presetsResponse.success && presetsResponse.data) {
        // カテゴリ名の日本語マッピング
        const categoryNames = {
          calling: '発信中（呼び出し音）',
          incoming: '着信音',
          outgoing: '発信音',
          disconnect: '切断音',
          doorchime: 'ドアチャイム'
        };
        for (const [category, sounds] of Object.entries(presetsResponse.data)) {
          if (Array.isArray(sounds) && sounds.length > 0) {
            const optgroup = document.createElement('optgroup');
            optgroup.label = categoryNames[category] || category;
            sounds.forEach(sound => {
              const option = document.createElement('option');
              option.value = `${category}:${sound.id}`;
              option.textContent = sound.label || sound.name || sound.id;
              optgroup.appendChild(option);
            });
            soundSelect.appendChild(optgroup);
          }
        }
      }
    } catch (error) {
      console.error('[HandSign] Failed to load preset sounds:', error);
    }

    // 現在の選択を反映
    const currentSound = settings.notifications?.soundPreset || 'outgoing:outgoing_horn';

    // カスタム音声が設定されている場合
    if (currentSound === 'custom' && settings.notifications?.customFileName) {
      updateCustomSoundInfo(settings.notifications.customFileName);
    } else {
      updateCustomSoundInfo(null);
      soundSelect.value = currentSound;
    }
  }

  /**
   * ハンドサイン設定モーダルを閉じる
   */
  function closeHandSignSettingsModal() {
    if (handSignSettingsModal) {
      handSignSettingsModal.classList.remove('rsc-active');
    }
  }

  /**
   * ハンドサイン設定を保存
   */
  async function saveHandSignSettings() {
    try {
      await chrome.runtime.sendMessage({
        type: 'SAVE_HAND_SIGN_SETTINGS',
        settings: settings
      });
    } catch (error) {
      console.error('[HandSign] Failed to save settings:', error);
    }
  }

  /**
   * 音声設定データを読み込む
   */
  async function loadSoundSettingsData() {
    try {
      // プリセット音声を取得
      const presetsResponse = await chrome.runtime.sendMessage({ type: 'GET_PRESET_SOUNDS' });
      if (presetsResponse && presetsResponse.success) {
        presetSounds = presetsResponse.data;
      }

      // 現在の設定を取得
      const settingsResponse = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
      if (settingsResponse && settingsResponse.success) {
        soundSettings = settingsResponse.data;
      }
    } catch (error) {
      console.error('[HandSign] Failed to load sound settings:', error);
    }
  }

  /**
   * 音声設定UIをレンダリング
   */
  function renderSoundSettings() {
    const content = soundSettingsModal.querySelector('.rsc-sound-settings-content');
    if (!presetSounds) {
      content.innerHTML = '<div class="rsc-sound-loading">音声データを読み込めませんでした</div>';
      return;
    }

    let html = '';

    // 各音声タイプ
    const soundTypes = ['calling', 'incoming', 'outgoing', 'disconnect', 'doorchime'];
    for (const type of soundTypes) {
      const label = SOUND_LABELS[type];
      const presets = presetSounds[type] || [];
      const currentSetting = soundSettings?.sounds?.[type] || { mode: 'original' };
      const currentMode = currentSetting.mode || 'original';
      const currentPresetId = currentSetting.presetId || '';

      const customFileName = currentSetting.customFileName || '';
      const hasCustom = currentMode === 'custom' && customFileName;

      html += `
        <div class="rsc-sound-item" data-type="${type}">
          <div class="rsc-sound-item-header">
            <span class="rsc-sound-item-label">${label}</span>
            <span class="rsc-sound-item-mode">${currentMode === 'original' ? 'オリジナル' : currentMode === 'preset' ? 'プリセット' : 'カスタム'}</span>
          </div>
          <div class="rsc-sound-select-row">
            <select class="rsc-sound-select" data-type="${type}">
              <option value="original"${currentMode === 'original' ? ' selected' : ''}>オリジナル</option>
              ${hasCustom ? `<option value="custom" selected>🎵 カスタム音声</option>` : ''}
              <optgroup label="プリセット">
                ${presets.map(p => `<option value="preset:${p.id}"${currentMode === 'preset' && currentPresetId === p.id ? ' selected' : ''}>${p.label}</option>`).join('')}
              </optgroup>
            </select>
            <button class="rsc-sound-play-btn" data-type="${type}" title="試聴">▶</button>
            <button class="rsc-sound-upload-btn" data-type="${type}" title="カスタム音声をアップロード">📁</button>
            <input type="file" class="rsc-sound-file-input" data-type="${type}" accept="audio/*" style="display:none;">
          </div>
          ${hasCustom ? `
            <div class="rsc-sound-custom-info" data-type="${type}">
              <span class="rsc-sound-custom-name">🎵 ${customFileName}</span>
              <button class="rsc-sound-custom-delete" data-type="${type}" title="削除">✕</button>
            </div>
          ` : ''}
        </div>
      `;
    }

    // 通知音設定
    const notifCustom = settings.notifications?.soundPreset === 'custom';
    const notifFileName = settings.notifications?.customFileName || '';
    html += `
      <div class="rsc-sound-notification">
        <div class="rsc-sound-notification-title">🔔 ハンドサイン検出時の通知音</div>
        <div class="rsc-sound-item" data-type="notification">
          <div class="rsc-sound-select-row">
            <select class="rsc-sound-select" data-type="notification" id="rsc-notification-sound-select">
              ${notifCustom ? '<option value="custom" selected>🎵 カスタム音声</option>' : ''}
              ${renderNotificationOptions()}
            </select>
            <button class="rsc-sound-play-btn" data-type="notification" title="試聴">▶</button>
            <button class="rsc-sound-upload-btn" data-type="notification" title="カスタム音声をアップロード">📁</button>
            <input type="file" class="rsc-sound-file-input" data-type="notification" accept="audio/*" style="display:none;">
          </div>
          ${notifCustom && notifFileName ? `
            <div class="rsc-sound-custom-info" data-type="notification">
              <span class="rsc-sound-custom-name">🎵 ${notifFileName}</span>
              <button class="rsc-sound-custom-delete" data-type="notification" title="削除">✕</button>
            </div>
          ` : ''}
        </div>
      </div>
    `;

    // カウントダウン音設定
    const countdownPresets = presetSounds.countdown || [];
    const currentCountdown = settings.countdown?.soundPreset || 'countdown:countdown_button2';
    html += `
      <div class="rsc-sound-notification">
        <div class="rsc-sound-notification-title">⏱️ 撮影5秒前カウントダウン音</div>
        <div class="rsc-sound-item" data-type="countdown">
          <div class="rsc-sound-select-row">
            <select class="rsc-sound-select" data-type="countdown">
              ${countdownPresets.map(p => `<option value="countdown:${p.id}"${currentCountdown === `countdown:${p.id}` ? ' selected' : ''}>${p.label}</option>`).join('')}
            </select>
            <button class="rsc-sound-play-btn" data-type="countdown" title="試聴">▶</button>
          </div>
        </div>
      </div>
    `;

    content.innerHTML = html;

    // イベントハンドラー
    content.querySelectorAll('.rsc-sound-select').forEach(select => {
      select.addEventListener('change', handleSoundChange);
    });
    content.querySelectorAll('.rsc-sound-play-btn').forEach(btn => {
      btn.addEventListener('click', handleSoundPreview);
    });
    content.querySelectorAll('.rsc-sound-upload-btn').forEach(btn => {
      btn.addEventListener('click', handleSoundUploadClick);
    });
    content.querySelectorAll('.rsc-sound-file-input').forEach(input => {
      input.addEventListener('change', handleSoundFileSelect);
    });
    content.querySelectorAll('.rsc-sound-custom-delete').forEach(btn => {
      btn.addEventListener('click', handleSoundCustomDelete);
    });
  }

  /**
   * 通知音オプションをレンダリング
   */
  function renderNotificationOptions() {
    const currentPreset = settings.notifications?.soundPreset || 'outgoing:outgoing_horn';
    let options = '';

    const categoryLabels = {
      outgoing: '発信音',
      incoming: '着信音',
      disconnect: '切断音',
      doorchime: 'ドアチャイム'
    };

    for (const [category, sounds] of Object.entries(presetSounds || {})) {
      if (category === 'calling') continue; // 呼び出し音は通知には不向き
      const label = categoryLabels[category] || category;
      options += `<optgroup label="${label}">`;
      for (const sound of sounds) {
        const value = `${category}:${sound.id}`;
        const selected = currentPreset === value ? ' selected' : '';
        options += `<option value="${value}"${selected}>${sound.label}</option>`;
      }
      options += '</optgroup>';
    }

    return options;
  }

  /**
   * 音声変更ハンドラー
   */
  async function handleSoundChange(e) {
    const type = e.target.dataset.type;
    const value = e.target.value;

    try {
      if (type === 'notification') {
        // 通知音設定
        settings.notifications = settings.notifications || {};
        settings.notifications.soundPreset = value;
        await chrome.storage.local.set({ handSignSettings: settings });
        showTimerToast('通知音を変更しました');
      } else if (type === 'countdown') {
        // カウントダウン音設定
        settings.countdown = settings.countdown || {};
        settings.countdown.soundPreset = value;
        await chrome.storage.local.set({ handSignSettings: settings });
        showTimerToast('カウントダウン音を変更しました');
      } else {
        // 通常の音声設定
        if (value === 'original') {
          await chrome.runtime.sendMessage({ type: 'SET_ORIGINAL', id: type });
        } else if (value.startsWith('preset:')) {
          const presetId = value.replace('preset:', '');
          await chrome.runtime.sendMessage({ type: 'SET_PRESET', id: type, presetId });
        }

        // モード表示を更新
        const item = e.target.closest('.rsc-sound-item');
        const modeSpan = item.querySelector('.rsc-sound-item-mode');
        if (modeSpan) {
          modeSpan.textContent = value === 'original' ? 'オリジナル' : 'プリセット';
        }
        showTimerToast('音声を変更しました');
      }
    } catch (error) {
      console.error('[HandSign] Failed to change sound:', error);
      showTimerToast('音声の変更に失敗しました');
    }
  }

  /**
   * 試聴ハンドラー
   */
  async function handleSoundPreview(e) {
    const type = e.target.closest('.rsc-sound-play-btn').dataset.type;
    const select = soundSettingsModal.querySelector(`.rsc-sound-select[data-type="${type}"]`);
    const value = select.value;

    try {
      let soundUrl = null;

      if (type === 'notification' || type === 'countdown') {
        // 通知音・カウントダウン音
        const [category, presetId] = value.split(':');
        const presets = presetSounds[category];
        if (presets) {
          const preset = presets.find(p => p.id === presetId);
          if (preset && preset.file) {
            soundUrl = chrome.runtime.getURL(`sounds/${category}/${preset.file}`);
          } else if (preset && !preset.file) {
            // なし（無音）の場合
            showTimerToast('無音が設定されています');
            return;
          }
        }
      } else if (value === 'original') {
        showTimerToast('オリジナル音はRemowork上で再生されます');
        return;
      } else if (value.startsWith('preset:')) {
        const presetId = value.replace('preset:', '');
        const presets = presetSounds[type];
        if (presets) {
          const preset = presets.find(p => p.id === presetId);
          if (preset) {
            soundUrl = chrome.runtime.getURL(`sounds/${type}/${preset.file}`);
          }
        }
      }

      if (soundUrl) {
        const audio = new Audio(soundUrl);
        audio.volume = 0.7;
        await audio.play();
      } else if (value === 'custom') {
        // カスタム音声の試聴
        if (type === 'notification') {
          const result = await chrome.storage.local.get('notificationCustomSound');
          if (result.notificationCustomSound?.data) {
            const audio = new Audio(result.notificationCustomSound.data);
            audio.volume = 0.7;
            await audio.play();
          }
        } else {
          const result = await chrome.runtime.sendMessage({ type: 'GET_SOUND', id: type });
          if (result.success && result.data) {
            const audio = new Audio(result.data);
            audio.volume = 0.7;
            await audio.play();
          }
        }
      }
    } catch (error) {
      console.error('[HandSign] Failed to preview sound:', error);
    }
  }

  /**
   * アップロードボタンクリックハンドラー
   */
  function handleSoundUploadClick(e) {
    const type = e.target.closest('.rsc-sound-upload-btn').dataset.type;
    const fileInput = soundSettingsModal.querySelector(`.rsc-sound-file-input[data-type="${type}"]`);
    if (fileInput) {
      fileInput.click();
    }
  }

  /**
   * ファイル選択ハンドラー
   */
  async function handleSoundFileSelect(e) {
    const type = e.target.dataset.type;
    const file = e.target.files[0];
    if (!file) return;

    // ファイルサイズチェック
    const maxSize = type === 'notification' ? 10 * 1024 * 1024 : 300 * 1024 * 1024;
    if (file.size > maxSize) {
      showTimerToast(`ファイルサイズが大きすぎます（最大${type === 'notification' ? '10MB' : '300MB'}）`);
      return;
    }

    try {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const base64Data = event.target.result;

        if (type === 'notification') {
          // 通知音カスタム
          await chrome.runtime.sendMessage({
            type: 'SAVE_NOTIFICATION_CUSTOM_SOUND',
            data: base64Data,
            fileName: file.name,
            mimeType: file.type
          });

          settings.notifications = settings.notifications || {};
          settings.notifications.soundPreset = 'custom';
          settings.notifications.customFileName = file.name;
          await chrome.storage.local.set({ handSignSettings: settings });
        } else {
          // 通常の音声カスタム
          await chrome.runtime.sendMessage({
            type: 'SAVE_SOUND',
            id: type,
            data: base64Data,
            fileName: file.name,
            mimeType: file.type
          });

          // soundSettingsも更新
          soundSettings.sounds = soundSettings.sounds || {};
          soundSettings.sounds[type] = {
            mode: 'custom',
            customFileName: file.name
          };
        }

        showTimerToast('カスタム音声を設定しました');

        // UIを再描画
        await loadSoundSettingsData();
        renderSoundSettings();
      };
      reader.readAsDataURL(file);
    } catch (error) {
      console.error('[HandSign] Failed to upload sound:', error);
      showTimerToast('アップロードに失敗しました');
    }

    // ファイル入力をリセット
    e.target.value = '';
  }

  /**
   * カスタム音声削除ハンドラー
   */
  async function handleSoundCustomDelete(e) {
    const type = e.target.closest('.rsc-sound-custom-delete').dataset.type;

    try {
      if (type === 'notification') {
        await chrome.runtime.sendMessage({ type: 'DELETE_NOTIFICATION_CUSTOM_SOUND' });

        settings.notifications = settings.notifications || {};
        settings.notifications.soundPreset = 'outgoing:outgoing_horn';
        settings.notifications.customFileName = null;
        await chrome.storage.local.set({ handSignSettings: settings });
      } else {
        await chrome.runtime.sendMessage({ type: 'DELETE_SOUND', id: type });

        soundSettings.sounds = soundSettings.sounds || {};
        soundSettings.sounds[type] = { mode: 'original' };
      }

      showTimerToast('カスタム音声を削除しました');

      // UIを再描画
      await loadSoundSettingsData();
      renderSoundSettings();
    } catch (error) {
      console.error('[HandSign] Failed to delete custom sound:', error);
    }
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

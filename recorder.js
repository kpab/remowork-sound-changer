/**
 * Remowork Sound Changer - Recorder
 * 通話録音機能（フローティングUI）
 */

(function() {
  'use strict';

  // 二重実行防止
  if (window.__remoworkRecorderLoaded) return;
  window.__remoworkRecorderLoaded = true;

  let mediaRecorder = null;
  let audioChunks = [];
  let recordingStartTime = null;
  let timerInterval = null;
  let recordings = [];
  let audioContext = null;
  let audioDestination = null;
  let currentPlayingAudio = null;
  let currentPlayingId = null;

  /**
   * レコーダーUIを作成
   */
  function createRecorderUI() {
    const container = document.createElement('div');
    container.id = 'rsc-recorder';
    container.className = 'rsc-recorder';

    container.innerHTML = `
      <div class="rsc-recorder-panel">
        <div class="rsc-recorder-header">
          <div class="rsc-recorder-title">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
              <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
            </svg>
            録音
          </div>
          <button class="rsc-recorder-minimize" title="最小化">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 13H5v-2h14v2z"/>
            </svg>
          </button>
        </div>
        <div class="rsc-recorder-body">
          <div class="rsc-recorder-status">
            <span class="rsc-recorder-indicator idle"></span>
            <span class="rsc-recorder-status-text">待機中</span>
          </div>
          <div class="rsc-recorder-time">00:00:00</div>
          <div class="rsc-recorder-controls">
            <button class="rsc-recorder-btn rsc-recorder-btn-record" title="録音開始">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <circle cx="12" cy="12" r="8"/>
              </svg>
            </button>
            <button class="rsc-recorder-btn rsc-recorder-btn-pause" title="一時停止" disabled>
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
              </svg>
            </button>
            <button class="rsc-recorder-btn rsc-recorder-btn-stop" title="停止" disabled>
              <svg viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="6" width="12" height="12"/>
              </svg>
            </button>
          </div>
          <div class="rsc-recorder-recordings"></div>
        </div>
      </div>
    `;

    document.body.appendChild(container);

    // イベントリスナーを設定
    setupEventListeners(container);

    // ドラッグ機能を設定
    setupDraggable(container);

    return container;
  }

  /**
   * イベントリスナーを設定
   */
  function setupEventListeners(container) {
    const recordBtn = container.querySelector('.rsc-recorder-btn-record');
    const pauseBtn = container.querySelector('.rsc-recorder-btn-pause');
    const stopBtn = container.querySelector('.rsc-recorder-btn-stop');
    const minimizeBtn = container.querySelector('.rsc-recorder-minimize');

    recordBtn.addEventListener('click', () => {
      if (mediaRecorder && mediaRecorder.state === 'recording') {
        // 録音中の場合は何もしない
        return;
      }
      startRecording();
    });

    pauseBtn.addEventListener('click', () => {
      if (mediaRecorder) {
        if (mediaRecorder.state === 'recording') {
          pauseRecording();
        } else if (mediaRecorder.state === 'paused') {
          resumeRecording();
        }
      }
    });

    stopBtn.addEventListener('click', () => {
      stopRecording();
    });

    minimizeBtn.addEventListener('click', () => {
      container.classList.toggle('minimized');
    });
  }

  /**
   * ドラッグ機能を設定
   */
  function setupDraggable(container) {
    const header = container.querySelector('.rsc-recorder-header');
    let isDragging = false;
    let offsetX, offsetY;

    header.addEventListener('mousedown', (e) => {
      if (e.target.closest('.rsc-recorder-minimize')) return;

      isDragging = true;
      container.classList.add('dragging');

      const rect = container.getBoundingClientRect();
      offsetX = e.clientX - rect.left;
      offsetY = e.clientY - rect.top;

      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;

      const x = e.clientX - offsetX;
      const y = e.clientY - offsetY;

      // 画面外に出ないように制限
      const maxX = window.innerWidth - container.offsetWidth;
      const maxY = window.innerHeight - container.offsetHeight;

      container.style.left = Math.max(0, Math.min(x, maxX)) + 'px';
      container.style.top = Math.max(0, Math.min(y, maxY)) + 'px';
      container.style.right = 'auto';
    });

    document.addEventListener('mouseup', () => {
      isDragging = false;
      container.classList.remove('dragging');
    });
  }

  /**
   * 録音を開始
   */
  async function startRecording() {
    try {
      // 通話の音声を取得（自分と相手の音声を両方キャプチャ）
      const stream = await captureAudioStream();

      if (!stream) {
        showError('音声ストリームを取得できませんでした');
        return;
      }

      audioChunks = [];
      recordingStartTime = Date.now();

      // MediaRecorderを作成
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
        saveRecording(blob);
      };

      mediaRecorder.start(1000); // 1秒ごとにデータを取得

      // UI更新
      updateUI('recording');
      startTimer();

      console.log('[RemoworkRecorder] Recording started');

    } catch (error) {
      console.error('[RemoworkRecorder] Failed to start recording:', error);
      showError('録音を開始できませんでした: ' + error.message);
    }
  }

  /**
   * 音声ストリームをキャプチャ（自分と相手の音声）
   */
  async function captureAudioStream() {
    try {
      // AudioContextを使用して複数の音声ソースをミックス
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      audioDestination = audioContext.createMediaStreamDestination();

      let hasMic = false;
      let hasTabAudio = false;

      // 1. マイク（自分の音声）を取得
      try {
        const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const micSource = audioContext.createMediaStreamSource(micStream);
        micSource.connect(audioDestination);
        hasMic = true;
        console.log('[RemoworkRecorder] Microphone connected');
      } catch (e) {
        console.warn('[RemoworkRecorder] Microphone not available:', e);
      }

      // 2. 画面共有で音声を取得（タブの音声をキャプチャ）
      // 重要: video: true が必要（falseだと音声共有オプションが出ない場合がある）
      try {
        // ユーザーに説明を表示
        showInfo('画面共有ダイアログで「タブの音声を共有」にチェックを入れてください');

        const displayStream = await navigator.mediaDevices.getDisplayMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            suppressLocalAudioPlayback: false
          },
          video: {
            width: 1,
            height: 1,
            frameRate: 1
          },
          preferCurrentTab: true,
          selfBrowserSurface: 'include',
          systemAudio: 'include'
        });

        const audioTracks = displayStream.getAudioTracks();
        console.log('[RemoworkRecorder] Audio tracks:', audioTracks.length);

        if (audioTracks.length > 0) {
          // 音声トラックのみを使用する新しいストリームを作成
          const audioOnlyStream = new MediaStream(audioTracks);
          const tabSource = audioContext.createMediaStreamSource(audioOnlyStream);
          tabSource.connect(audioDestination);
          hasTabAudio = true;
          console.log('[RemoworkRecorder] Tab audio connected via getDisplayMedia');

          // ビデオトラックを停止（音声には影響しない）
          displayStream.getVideoTracks().forEach(track => {
            console.log('[RemoworkRecorder] Stopping video track:', track.label);
            track.stop();
          });
        } else {
          console.warn('[RemoworkRecorder] No audio tracks in display stream - did you check "Share tab audio"?');
          showError('タブの音声が共有されていません。\n「タブの音声を共有」にチェックを入れてください。');
        }
      } catch (e) {
        console.warn('[RemoworkRecorder] Tab audio capture failed:', e);

        // 代替方法: ページ内のaudio/video要素から直接キャプチャ
        const audioElements = document.querySelectorAll('audio, video');
        console.log('[RemoworkRecorder] Found audio/video elements:', audioElements.length);

        for (const element of audioElements) {
          try {
            // srcObjectがある場合（WebRTCストリーム）
            if (element.srcObject && element.srcObject.getAudioTracks().length > 0) {
              const source = audioContext.createMediaStreamSource(element.srcObject);
              source.connect(audioDestination);
              hasTabAudio = true;
              console.log('[RemoworkRecorder] Audio element stream connected:', element.srcObject.id);
            }
            // captureStreamが使える場合
            else if (element.captureStream) {
              const stream = element.captureStream();
              if (stream.getAudioTracks().length > 0) {
                const source = audioContext.createMediaStreamSource(stream);
                source.connect(audioDestination);
                hasTabAudio = true;
                console.log('[RemoworkRecorder] Audio element captureStream connected');
              }
            }
          } catch (err) {
            console.warn('[RemoworkRecorder] Could not capture audio element:', err);
          }
        }
      }

      if (!hasMic && !hasTabAudio) {
        throw new Error('音声ソースが見つかりません');
      }

      // 録音ソースの状態を表示
      const sources = [];
      if (hasMic) sources.push('マイク');
      if (hasTabAudio) sources.push('タブ音声');
      showInfo(`録音開始: ${sources.join(' + ')}`);

      return audioDestination.stream;

    } catch (error) {
      console.error('[RemoworkRecorder] Failed to capture audio:', error);
      return null;
    }
  }

  /**
   * 情報メッセージを表示
   */
  function showInfo(message) {
    console.log('[RemoworkRecorder] Info:', message);
    // 一時的なトースト表示
    const toast = document.createElement('div');
    toast.className = 'rsc-toast rsc-toast-info';
    toast.textContent = message;
    toast.style.cssText = `
      position: fixed;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: #2196F3;
      color: white;
      padding: 12px 24px;
      border-radius: 8px;
      z-index: 100001;
      font-size: 14px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    `;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
  }

  /**
   * 録音を一時停止
   */
  function pauseRecording() {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.pause();
      stopTimer();
      updateUI('paused');
      console.log('[RemoworkRecorder] Recording paused');
    }
  }

  /**
   * 録音を再開
   */
  function resumeRecording() {
    if (mediaRecorder && mediaRecorder.state === 'paused') {
      mediaRecorder.resume();
      startTimer();
      updateUI('recording');
      console.log('[RemoworkRecorder] Recording resumed');
    }
  }

  /**
   * 録音を停止
   */
  function stopRecording() {
    if (mediaRecorder && (mediaRecorder.state === 'recording' || mediaRecorder.state === 'paused')) {
      mediaRecorder.stop();
      stopTimer();
      updateUI('idle');
      console.log('[RemoworkRecorder] Recording stopped');
    }
  }

  /**
   * 録音を保存
   */
  function saveRecording(blob) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const recording = {
      id: Date.now(),
      name: `録音_${timestamp}`,
      blob: blob,
      duration: formatTime(Date.now() - recordingStartTime),
      date: new Date().toLocaleString('ja-JP')
    };

    recordings.unshift(recording);
    updateRecordingsList();

    console.log('[RemoworkRecorder] Recording saved:', recording.name);
  }

  /**
   * 録音リストを更新
   */
  function updateRecordingsList() {
    const container = document.querySelector('.rsc-recorder-recordings');
    if (!container) return;

    if (recordings.length === 0) {
      container.innerHTML = '';
      return;
    }

    let html = '<div class="rsc-recorder-recordings-title">録音履歴</div>';

    for (const recording of recordings.slice(0, 5)) { // 最新5件を表示
      const isPlaying = currentPlayingId === recording.id;
      html += `
        <div class="rsc-recording-item" data-id="${recording.id}">
          <div class="rsc-recording-info">
            <span class="rsc-recording-name">${recording.name}</span>
            <span class="rsc-recording-meta">${recording.duration}</span>
          </div>
          <div class="rsc-recording-actions">
            <button class="rsc-recording-btn rsc-recording-play ${isPlaying ? 'playing' : ''}" data-id="${recording.id}" title="${isPlaying ? '停止' : '再生'}">
              <svg class="icon-play" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="${isPlaying ? 'display:none' : ''}">
                <path d="M8 5v14l11-7z"/>
              </svg>
              <svg class="icon-stop" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="${isPlaying ? '' : 'display:none'}">
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

    // ダウンロードボタンのイベント
    container.querySelectorAll('.rsc-recording-download').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const button = e.currentTarget;
        const id = parseInt(button.dataset.id);
        downloadRecording(id);
      });
    });

    // 再生ボタンのイベント
    container.querySelectorAll('.rsc-recording-play').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const button = e.currentTarget;
        const id = parseInt(button.dataset.id);
        console.log('[RemoworkRecorder] Play button clicked, id:', id);
        playRecording(id);
      });
    });

    // 削除ボタンのイベント
    container.querySelectorAll('.rsc-recording-delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const button = e.currentTarget;
        const id = parseInt(button.dataset.id);
        deleteRecording(id);
      });
    });
  }

  /**
   * 録音を削除
   */
  function deleteRecording(id) {
    const index = recordings.findIndex(r => r.id === id);
    if (index === -1) return;

    const recording = recordings[index];

    // 確認ダイアログ
    if (!confirm(`「${recording.name}」を削除しますか？`)) {
      return;
    }

    // 再生中なら停止
    if (currentPlayingId === id) {
      stopPlayback();
    }

    // 配列から削除
    recordings.splice(index, 1);

    // リストを更新
    updateRecordingsList();

    console.log('[RemoworkRecorder] Recording deleted:', recording.name);
  }

  /**
   * 録音をダウンロード（MP3に変換）
   */
  async function downloadRecording(id) {
    const recording = recordings.find(r => r.id === id);
    if (!recording) return;

    try {
      // WebMをそのままダウンロード（MP3変換は複雑なため）
      const url = URL.createObjectURL(recording.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${recording.name}.webm`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      console.log('[RemoworkRecorder] Downloaded:', recording.name);

    } catch (error) {
      console.error('[RemoworkRecorder] Download failed:', error);
      showError('ダウンロードに失敗しました');
    }
  }

  /**
   * 再生を停止する共通関数
   */
  function stopPlayback() {
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
   * 録音を再生
   */
  function playRecording(id) {
    // 同じ録音を再生中なら停止
    if (currentPlayingId === id) {
      stopPlayback();
      return;
    }

    // 他の再生を停止
    stopPlayback();

    const recording = recordings.find(r => r.id === id);
    if (!recording) return;

    const url = URL.createObjectURL(recording.blob);
    const audio = new Audio(url);
    currentPlayingAudio = audio;
    currentPlayingId = id;

    updateRecordingsList();

    audio.play();

    audio.onended = () => {
      URL.revokeObjectURL(url);
      currentPlayingAudio = null;
      currentPlayingId = null;
      updateRecordingsList();
    };

    audio.onerror = () => {
      URL.revokeObjectURL(url);
      currentPlayingAudio = null;
      currentPlayingId = null;
      updateRecordingsList();
    };
  }

  /**
   * UIを更新
   */
  function updateUI(state) {
    const container = document.querySelector('#rsc-recorder');
    if (!container) return;

    const indicator = container.querySelector('.rsc-recorder-indicator');
    const statusText = container.querySelector('.rsc-recorder-status-text');
    const recordBtn = container.querySelector('.rsc-recorder-btn-record');
    const pauseBtn = container.querySelector('.rsc-recorder-btn-pause');
    const stopBtn = container.querySelector('.rsc-recorder-btn-stop');

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
        container.querySelector('.rsc-recorder-time').textContent = '00:00:00';
        break;
    }
  }

  /**
   * タイマーを開始
   */
  function startTimer() {
    timerInterval = setInterval(() => {
      const elapsed = Date.now() - recordingStartTime;
      const timeEl = document.querySelector('.rsc-recorder-time');
      if (timeEl) {
        timeEl.textContent = formatTime(elapsed);
      }
    }, 1000);
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
   * 時間をフォーマット
   */
  function formatTime(ms) {
    const seconds = Math.floor(ms / 1000);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    return [hours, minutes, secs]
      .map(n => n.toString().padStart(2, '0'))
      .join(':');
  }

  /**
   * エラーを表示
   */
  function showError(message) {
    alert('[Remowork Recorder] ' + message);
  }

  // CSSを読み込み
  function loadCSS() {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = chrome.runtime.getURL('recorder.css');
    document.head.appendChild(link);
  }

  // 初期化
  loadCSS();
  createRecorderUI();

  console.log('[RemoworkRecorder] Initialized');
})();

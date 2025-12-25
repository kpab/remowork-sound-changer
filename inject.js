/**
 * Remowork Sound Changer - Inject Script
 * ページコンテキストで実行され、Howler.js と Audio オブジェクトをオーバーライド
 */

(function() {
  'use strict';

  // 二重実行防止
  if (window.__remoworkSoundChangerInjected) return;
  window.__remoworkSoundChangerInjected = true;

  // 設定を取得（CSP対応: data属性から読み取り）
  let config = { enabled: false, sounds: {} };
  const configElement = document.getElementById('__remoworkSoundConfig');
  if (configElement && configElement.dataset.config) {
    try {
      config = JSON.parse(configElement.dataset.config);
    } catch (e) {
      console.error('[RemoworkSoundChanger] Failed to parse config:', e);
    }
  }

  if (!config.enabled) {
    console.log('[RemoworkSoundChanger] Disabled');
    return;
  }

  console.log('[RemoworkSoundChanger] Initializing with config:', config);

  // 対象パスのマッピング（複数パス対応）
  const pathToId = {};
  for (const [id, soundConfig] of Object.entries(config.sounds)) {
    // メインパス
    if (soundConfig.path) {
      pathToId[soundConfig.path] = id;
      console.log(`[RemoworkSoundChanger] Mapping ${soundConfig.path} -> ${id}`);
    }
    // 追加パス（paths配列がある場合）
    if (soundConfig.paths && Array.isArray(soundConfig.paths)) {
      for (const path of soundConfig.paths) {
        pathToId[path] = id;
        console.log(`[RemoworkSoundChanger] Mapping ${path} -> ${id}`);
      }
    }
  }

  // カスタム音声のキャッシュ（Blob URL）
  const customSoundCache = {};

  // 再生中の音声を追跡（着信応答時に停止するため）
  const activeHowls = new Set();
  const activeAudios = new Set();

  /**
   * URLから対象音声IDを取得
   */
  function getSoundIdFromUrl(url) {
    if (!url) return null;

    // 配列の場合は最初の要素を使用
    const urlStr = Array.isArray(url) ? url[0] : url;
    if (typeof urlStr !== 'string') return null;

    try {
      const urlObj = new URL(urlStr, window.location.origin);
      const pathname = urlObj.pathname;

      for (const [path, id] of Object.entries(pathToId)) {
        if (pathname.endsWith(path) || pathname === path) {
          return id;
        }
      }
    } catch (e) {
      // パースエラーは無視
    }

    return null;
  }

  /**
   * 拡張機能のベースURLを取得
   */
  function getExtensionBaseUrl() {
    const scripts = document.getElementsByTagName('script');
    for (const script of scripts) {
      if (script.src && script.src.includes('inject.js')) {
        return script.src.replace('inject.js', '');
      }
    }
    return null;
  }

  const extensionBaseUrl = getExtensionBaseUrl();

  /**
   * カスタム音声のURLを取得
   */
  function getCustomSoundUrl(soundId) {
    const soundConfig = config.sounds[soundId];
    if (!soundConfig) return null;

    // カスタム音声（Base64データ）
    if (soundConfig.mode === 'custom' && soundConfig.customData) {
      if (!customSoundCache[soundId]) {
        customSoundCache[soundId] = soundConfig.customData;
      }
      return customSoundCache[soundId];
    }

    // プリセット音声（拡張機能内のファイル）
    if (soundConfig.mode === 'preset' && soundConfig.presetFile && extensionBaseUrl) {
      // soundId からカテゴリを取得（例: doorchime -> doorchime）
      const category = soundId;
      const presetUrl = `${extensionBaseUrl}sounds/${category}/${encodeURIComponent(soundConfig.presetFile)}`;
      console.log(`[RemoworkSoundChanger] Preset URL: ${presetUrl}`);
      return presetUrl;
    }

    return null;
  }

  // オリジナルの Audio コンストラクタを保存
  const OriginalAudio = window.Audio;

  /**
   * Audio コンストラクタをオーバーライド
   */
  window.Audio = function(src) {
    const soundId = getSoundIdFromUrl(src);

    if (soundId) {
      const customUrl = getCustomSoundUrl(soundId);
      if (customUrl) {
        console.log(`[RemoworkSoundChanger] Audio() intercepted for ${soundId}`);
        return new OriginalAudio(customUrl);
      }
    }

    return new OriginalAudio(src);
  };
  window.Audio.prototype = OriginalAudio.prototype;

  /**
   * HTMLAudioElement の src プロパティをオーバーライド
   */
  const originalSrcDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');

  Object.defineProperty(HTMLMediaElement.prototype, 'src', {
    get: function() {
      return originalSrcDescriptor.get.call(this);
    },
    set: function(value) {
      const soundId = getSoundIdFromUrl(value);

      if (soundId && this instanceof HTMLAudioElement) {
        const customUrl = getCustomSoundUrl(soundId);
        if (customUrl) {
          console.log(`[RemoworkSoundChanger] src setter intercepted for ${soundId}`);
          return originalSrcDescriptor.set.call(this, customUrl);
        }
      }

      return originalSrcDescriptor.set.call(this, value);
    },
    enumerable: true,
    configurable: true
  });

  /**
   * Howler.js の Howl コンストラクタをオーバーライド
   * Howler.js は Web Audio API を使用するため、src を差し替える必要がある
   */
  function interceptHowler() {
    if (typeof window.Howl === 'undefined') {
      return false;
    }

    const OriginalHowl = window.Howl;

    window.Howl = function(options) {
      let interceptedSoundId = null;

      if (options && options.src) {
        const srcArray = Array.isArray(options.src) ? options.src : [options.src];
        const soundId = getSoundIdFromUrl(srcArray[0]);

        if (soundId) {
          const customUrl = getCustomSoundUrl(soundId);
          if (customUrl) {
            console.log(`[RemoworkSoundChanger] Howl() intercepted for ${soundId}`);
            interceptedSoundId = soundId;
            // カスタムURLに置き換え
            options = Object.assign({}, options, {
              src: [customUrl],
              format: ['mp3', 'wav', 'ogg', 'webm'] // Base64データURLをサポート
            });
          }
        }
      }

      const howl = new OriginalHowl(options);

      // カスタム音声の場合、再生開始・停止を追跡
      if (interceptedSoundId) {
        const originalPlay = howl.play.bind(howl);
        const originalStop = howl.stop.bind(howl);
        const originalPause = howl.pause.bind(howl);

        howl.play = function(...args) {
          activeHowls.add(howl);
          return originalPlay(...args);
        };

        howl.stop = function(...args) {
          activeHowls.delete(howl);
          return originalStop(...args);
        };

        howl.pause = function(...args) {
          activeHowls.delete(howl);
          return originalPause(...args);
        };

        // 再生終了時にも削除
        howl.on('end', () => {
          activeHowls.delete(howl);
        });
      }

      return howl;
    };

    // プロトタイプとスタティックプロパティを継承
    window.Howl.prototype = OriginalHowl.prototype;
    Object.keys(OriginalHowl).forEach(key => {
      if (OriginalHowl.hasOwnProperty(key)) {
        window.Howl[key] = OriginalHowl[key];
      }
    });

    console.log('[RemoworkSoundChanger] Howler.js intercepted');
    return true;
  }

  // Howler.js がロードされるのを待つ
  if (!interceptHowler()) {
    // Howler.js がまだロードされていない場合は監視
    let attempts = 0;
    const maxAttempts = 50; // 5秒間監視
    const checkInterval = setInterval(() => {
      attempts++;
      if (interceptHowler() || attempts >= maxAttempts) {
        clearInterval(checkInterval);
        if (attempts >= maxAttempts) {
          console.log('[RemoworkSoundChanger] Howler.js not found, using Audio interception only');
        }
      }
    }, 100);
  }

  /**
   * XMLHttpRequest もオーバーライド（Howler.js が音声をロードする際に使用）
   */
  const OriginalXHR = window.XMLHttpRequest;

  window.XMLHttpRequest = function() {
    const xhr = new OriginalXHR();
    const originalOpen = xhr.open;

    xhr.open = function(method, url, ...args) {
      const soundId = getSoundIdFromUrl(url);

      if (soundId) {
        const customUrl = getCustomSoundUrl(soundId);
        if (customUrl) {
          console.log(`[RemoworkSoundChanger] XHR intercepted for ${soundId}`);
          return originalOpen.call(this, method, customUrl, ...args);
        }
      }

      return originalOpen.call(this, method, url, ...args);
    };

    return xhr;
  };
  window.XMLHttpRequest.prototype = OriginalXHR.prototype;

  /**
   * fetch もオーバーライド
   */
  const originalFetch = window.fetch;

  window.fetch = function(input, init) {
    let url = typeof input === 'string' ? input : (input instanceof Request ? input.url : null);

    if (url) {
      const soundId = getSoundIdFromUrl(url);

      if (soundId) {
        const customUrl = getCustomSoundUrl(soundId);
        if (customUrl) {
          console.log(`[RemoworkSoundChanger] fetch intercepted for ${soundId}`);
          // Base64 data URL の場合は直接 Response を返す
          if (customUrl.startsWith('data:')) {
            return fetch(customUrl);
          }
          input = customUrl;
        }
      }
    }

    return originalFetch.call(this, input, init);
  };

  /**
   * 設定変更をリアルタイムで受信
   */
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (!event.data || event.data.source !== 'remowork-sound-changer-content') return;

    if (event.data.type === 'CONFIG_UPDATED' && event.data.config) {
      console.log('[RemoworkSoundChanger] Config updated:', event.data.config);

      // 設定を更新
      Object.assign(config, event.data.config);

      // パスマッピングを再構築（複数パス対応）
      Object.keys(pathToId).forEach(key => delete pathToId[key]);
      for (const [id, soundConfig] of Object.entries(config.sounds)) {
        // メインパス
        if (soundConfig.path) {
          pathToId[soundConfig.path] = id;
        }
        // 追加パス（paths配列がある場合）
        if (soundConfig.paths && Array.isArray(soundConfig.paths)) {
          for (const path of soundConfig.paths) {
            pathToId[path] = id;
          }
        }
      }

      // キャッシュをクリア
      Object.keys(customSoundCache).forEach(key => delete customSoundCache[key]);

      console.log('[RemoworkSoundChanger] Config reloaded - changes will apply to new audio requests');
    }
  });

  /**
   * 全てのカスタム音声を停止
   */
  function stopAllCustomSounds() {
    // Howlオブジェクトを停止
    activeHowls.forEach(howl => {
      try {
        howl.stop();
      } catch (e) {
        console.warn('[RemoworkSoundChanger] Failed to stop Howl:', e);
      }
    });
    activeHowls.clear();

    // Audioオブジェクトを停止
    activeAudios.forEach(audio => {
      try {
        audio.pause();
        audio.currentTime = 0;
      } catch (e) {
        console.warn('[RemoworkSoundChanger] Failed to stop Audio:', e);
      }
    });
    activeAudios.clear();

    console.log('[RemoworkSoundChanger] All custom sounds stopped');
  }

  // グローバルに公開（外部から呼び出し可能に）
  window.__remoworkStopAllSounds = stopAllCustomSounds;

  /**
   * 通話関連ボタンのクリックを監視して音声を停止
   */
  function setupCallButtonWatcher() {
    document.addEventListener('click', (event) => {
      const target = event.target;
      if (!target) return;

      // ボタンまたはその親要素を検索
      const button = target.closest('button, [role="button"], .btn, [class*="call"], [class*="answer"], [class*="accept"]');
      if (!button) return;

      // 通話関連のボタンかどうかをクラス名やテキストで判断
      const buttonText = button.textContent?.toLowerCase() || '';
      const buttonClass = button.className?.toLowerCase() || '';

      const isCallButton =
        buttonText.includes('応答') ||
        buttonText.includes('通話') ||
        buttonText.includes('answer') ||
        buttonText.includes('accept') ||
        buttonClass.includes('call') ||
        buttonClass.includes('answer') ||
        buttonClass.includes('accept') ||
        buttonClass.includes('phone');

      if (isCallButton) {
        console.log('[RemoworkSoundChanger] Call button clicked, stopping all sounds');
        stopAllCustomSounds();
      }
    }, true); // キャプチャフェーズで処理

    console.log('[RemoworkSoundChanger] Call button watcher initialized');
  }

  setupCallButtonWatcher();

  console.log('[RemoworkSoundChanger] Ready - Intercepting Howler.js, Audio, XHR, and fetch');

  // =============================================
  // 文字起こし機能 (Web Speech API)
  // ページコンテキストで実行することでnetworkエラーを回避
  // =============================================

  let speechRecognition = null;
  let isTranscribing = false;
  let transcriptText = '';
  let lastInterimTranscript = ''; // 最後の暫定結果を保持
  let networkErrorRetryCount = 0;
  const MAX_NETWORK_RETRIES = 3;
  const NETWORK_RETRY_DELAY = 2000;

  /**
   * 文字起こしを開始
   * @param {string} deviceId - 使用するマイクデバイスのID（空の場合はデフォルト）
   */
  async function startTranscription(deviceId = '') {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn('[RemoworkTranscription] Web Speech API not supported');
      window.dispatchEvent(new CustomEvent('remowork-transcription-error', {
        detail: { error: 'not-supported', message: 'このブラウザは文字起こしに対応していません' }
      }));
      return;
    }

    if (isTranscribing) return;

    transcriptText = '';
    lastInterimTranscript = '';
    isTranscribing = true;
    networkErrorRetryCount = 0;

    // 注意: ここではマイクストリームを追加取得しない
    // Web Speech APIはブラウザのデフォルトマイクを使用する
    // 通話で既にマイクを使用中の場合、追加のgetUserMediaは競合の原因になりうる
    //
    // 相手の音声も文字起こしするには、ユーザーがOSレベルで
    // 「ステレオミキサー」や仮想オーディオデバイスをデフォルトマイクに設定する必要がある
    if (deviceId) {
      console.log('[RemoworkTranscription] Device ID specified:', deviceId);
      console.log('[RemoworkTranscription] Note: SpeechRecognition uses browser default mic. Set this device as system default for it to work.');
    }

    speechRecognition = new SpeechRecognition();
    speechRecognition.continuous = true;
    speechRecognition.interimResults = true;
    speechRecognition.lang = 'ja-JP';

    speechRecognition.onresult = (event) => {
      let interimTranscript = '';
      let finalTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript;
        } else {
          interimTranscript += transcript;
        }
      }

      if (finalTranscript) {
        transcriptText += finalTranscript + '\n';
        lastInterimTranscript = ''; // 確定したらクリア
      } else {
        lastInterimTranscript = interimTranscript; // 暫定結果を保持
      }

      // Content Scriptにイベントで結果を送信
      window.dispatchEvent(new CustomEvent('remowork-transcription-result', {
        detail: {
          transcript: transcriptText,
          interim: interimTranscript,
          isFinal: !!finalTranscript
        }
      }));
    };

    speechRecognition.onerror = (event) => {
      console.warn('[RemoworkTranscription] Speech recognition error:', event.error);

      if (event.error === 'network') {
        networkErrorRetryCount++;
        console.log(`[RemoworkTranscription] Network error, retry ${networkErrorRetryCount}/${MAX_NETWORK_RETRIES}`);

        if (networkErrorRetryCount <= MAX_NETWORK_RETRIES && isTranscribing) {
          // 再接続中のメッセージを文字起こしに追加して通知
          const retryMessage = `\n[⏳ 再接続中... (${networkErrorRetryCount}/${MAX_NETWORK_RETRIES})]\n`;
          window.dispatchEvent(new CustomEvent('remowork-transcription-result', {
            detail: {
              transcript: transcriptText + retryMessage,
              interim: '',
              isFinal: false
            }
          }));

          // 少し待ってから再接続を試みる
          setTimeout(() => {
            if (isTranscribing && speechRecognition) {
              try {
                speechRecognition.start();
                console.log('[RemoworkTranscription] Reconnected after network error');
                // 再接続成功メッセージを追加
                transcriptText += `\n[✓ 再接続成功]\n`;
                window.dispatchEvent(new CustomEvent('remowork-transcription-result', {
                  detail: {
                    transcript: transcriptText,
                    interim: '',
                    isFinal: false
                  }
                }));
                networkErrorRetryCount = 0;
              } catch (e) {
                console.warn('[RemoworkTranscription] Reconnection failed:', e);
              }
            }
          }, NETWORK_RETRY_DELAY);
          return;
        }

        // リトライ上限に達した場合はエラーメッセージを文字起こしに追加
        const errorMessage = `\n[❌ ネットワークエラー：再接続に失敗しました]\n`;
        transcriptText += errorMessage;
        isTranscribing = false;
        window.dispatchEvent(new CustomEvent('remowork-transcription-error', {
          detail: { error: 'network', message: 'ネットワークエラー：文字起こし利用不可', transcript: transcriptText }
        }));
        return;
      }

      if (event.error === 'not-allowed') {
        isTranscribing = false;
        window.dispatchEvent(new CustomEvent('remowork-transcription-error', {
          detail: { error: 'not-allowed', message: 'マイクへのアクセスが拒否されました' }
        }));
        return;
      }

      // no-speechエラーの場合は再起動
      if (event.error === 'no-speech' && isTranscribing) {
        setTimeout(() => {
          if (isTranscribing && speechRecognition) {
            try {
              speechRecognition.start();
            } catch (e) {}
          }
        }, 100);
      }
    };

    speechRecognition.onend = () => {
      // 再起動前に暫定結果があれば確定として保存
      if (lastInterimTranscript) {
        transcriptText += lastInterimTranscript + '\n';
        lastInterimTranscript = '';
        // 更新を通知
        window.dispatchEvent(new CustomEvent('remowork-transcription-result', {
          detail: {
            transcript: transcriptText,
            interim: '',
            isFinal: true
          }
        }));
      }

      if (isTranscribing) {
        try {
          speechRecognition.start();
        } catch (e) {}
      }
    };

    try {
      speechRecognition.start();
      console.log('[RemoworkTranscription] Transcription started');
      window.dispatchEvent(new CustomEvent('remowork-transcription-started'));
    } catch (e) {
      console.error('[RemoworkTranscription] Failed to start:', e);
      isTranscribing = false;
      window.dispatchEvent(new CustomEvent('remowork-transcription-error', {
        detail: { error: 'start-failed', message: e.message }
      }));
    }
  }

  function stopTranscription() {
    isTranscribing = false;
    if (speechRecognition) {
      try {
        speechRecognition.stop();
      } catch (e) {}
      speechRecognition = null;
    }
    console.log('[RemoworkTranscription] Transcription stopped');
    window.dispatchEvent(new CustomEvent('remowork-transcription-stopped', {
      detail: { transcript: transcriptText }
    }));
  }

  // Content Scriptからのコマンドを受信
  window.addEventListener('remowork-transcription-start', (event) => {
    const deviceId = event.detail?.deviceId || '';
    startTranscription(deviceId);
  });

  window.addEventListener('remowork-transcription-stop', () => {
    stopTranscription();
  });

  // グローバルに公開（デバッグ用）
  window.__remoworkTranscription = {
    start: startTranscription,
    stop: stopTranscription,
    isTranscribing: () => isTranscribing,
    getTranscript: () => transcriptText
  };

  console.log('[RemoworkTranscription] Ready - Access via window.__remoworkTranscription');
})();

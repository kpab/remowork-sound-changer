/**
 * Offscreen Document for Hand Pose Detection
 * MediaPipe Tasks Vision を使用した本格的な手検出
 */

import { HandLandmarker, FilesetResolver } from './lib/mediapipe/vision_bundle.js';

let handLandmarker = null;
let isInitialized = false;

// 初期化中のPromiseを保持（複数の呼び出しを待機させるため）
let initPromise = null;

// 最後の初期化エラーを保持
let lastInitError = null;

/**
 * MediaPipe Hand Landmarker を初期化
 * 複数の呼び出しがあっても、一度だけ初期化を実行し、他は完了を待つ
 */
async function initDetector() {
  // 既に初期化済み
  if (isInitialized) return { success: true };

  // 初期化中なら、そのPromiseを待つ
  if (initPromise) {
    console.log('[Offscreen] Waiting for existing initialization...');
    return initPromise;
  }

  // 初期化を開始
  initPromise = (async () => {
    lastInitError = null;

    try {
      console.log('[Offscreen] Initializing MediaPipe Hand Landmarker...');

      // FilesetResolver を使ってWASMファイルを読み込む
      const wasmPath = chrome.runtime.getURL('lib/mediapipe/');
      console.log('[Offscreen] WASM path:', wasmPath);

      const vision = await FilesetResolver.forVisionTasks(wasmPath);
      console.log('[Offscreen] FilesetResolver ready');

      const modelPath = chrome.runtime.getURL('lib/mediapipe/hand_landmarker.task');
      console.log('[Offscreen] Model path:', modelPath);

      // Hand Landmarker を作成（GPU優先、失敗時はCPUにフォールバック）
      try {
        handLandmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: modelPath,
            delegate: 'GPU'
          },
          runningMode: 'IMAGE',
          numHands: 2
        });
        console.log('[Offscreen] Using GPU delegate');
      } catch (gpuError) {
        const gpuErrorMsg = gpuError?.message || String(gpuError);
        console.warn('[Offscreen] GPU delegate failed, falling back to CPU:', gpuErrorMsg);
        handLandmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: modelPath,
            delegate: 'CPU'
          },
          runningMode: 'IMAGE',
          numHands: 2
        });
        console.log('[Offscreen] Using CPU delegate');
      }

      isInitialized = true;
      console.log('[Offscreen] MediaPipe Hand Landmarker initialized successfully');
      return { success: true };
    } catch (error) {
      const errorMsg = error?.message || String(error);
      console.error('[Offscreen] Failed to initialize:', errorMsg);
      lastInitError = errorMsg;
      // 失敗時はPromiseをクリアして再試行可能にする
      initPromise = null;
      return { success: false, error: errorMsg };
    }
  })();

  return initPromise;
}

/**
 * 手のランドマークからジェスチャーを検出
 * 手が検出されたら「お話しOK」を返す
 */
function detectGesture(landmarks) {
  if (!landmarks || landmarks.length === 0) return null;

  // 手が検出された = お話しOK
  return { type: 'talk_ok', emoji: '🙋', message: 'お話しOKです' };
}

/**
 * 画像データからハンドサインを検出
 */
async function detectHandSign(imageData) {
  if (!isInitialized || !handLandmarker) {
    const success = await initDetector();
    if (!success) {
      return { success: false, error: 'Detector not initialized' };
    }
  }

  try {
    // ImageData から ImageBitmap を作成
    const imageBitmap = await createImageBitmap(
      new ImageData(
        new Uint8ClampedArray(imageData.data),
        imageData.width,
        imageData.height
      )
    );

    // 手を検出
    const results = handLandmarker.detect(imageBitmap);
    imageBitmap.close();

    if (!results.landmarks || results.landmarks.length === 0) {
      return { success: true, gesture: null };
    }

    // 最初に検出された手のランドマーク
    const landmarks = results.landmarks[0];
    const gesture = detectGesture(landmarks);

    return { success: true, gesture };
  } catch (error) {
    console.error('[Offscreen] Detection error:', error);
    return { success: false, error: error.message };
  }
}

// メッセージリスナー
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== 'offscreen') return false;

  switch (message.type) {
    case 'INIT_DETECTOR':
      initDetector().then(result => {
        sendResponse(result);
      });
      return true;

    case 'DETECT_HAND_SIGN':
      detectHandSign(message.imageData).then(result => {
        sendResponse(result);
      });
      return true;

    case 'GET_STATUS':
      sendResponse({
        initialized: isInitialized,
        initializing: initPromise !== null && !isInitialized,
        lastError: lastInitError
      });
      return true;

    // 文字起こし関連
    case 'START_TRANSCRIPTION':
      sendResponse(startTranscription());
      return true;

    case 'STOP_TRANSCRIPTION':
      sendResponse(stopTranscription());
      return true;

    case 'GET_TRANSCRIPT':
      sendResponse(getTranscript());
      return true;

    default:
      return false;
  }
});

// =============================================
// 文字起こし機能 (Web Speech API)
// =============================================

let speechRecognition = null;
let isTranscribing = false;
let transcriptText = '';

/**
 * 文字起こしを開始
 */
function startTranscription() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    console.warn('[Offscreen] Web Speech API not supported');
    return { success: false, error: 'Web Speech API not supported' };
  }

  if (isTranscribing) {
    return { success: true, message: 'Already transcribing' };
  }

  transcriptText = '';
  isTranscribing = true;

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
    }

    // Content Scriptに結果を送信
    chrome.runtime.sendMessage({
      type: 'TRANSCRIPTION_RESULT',
      transcript: transcriptText,
      interim: interimTranscript,
      isFinal: !!finalTranscript
    });
  };

  speechRecognition.onerror = (event) => {
    console.warn('[Offscreen] Speech recognition error:', event.error);

    if (event.error === 'network') {
      isTranscribing = false;
      chrome.runtime.sendMessage({
        type: 'TRANSCRIPTION_ERROR',
        error: 'network',
        message: 'ネットワークエラー：文字起こし利用不可'
      });
      return;
    }

    if (event.error === 'not-allowed') {
      isTranscribing = false;
      chrome.runtime.sendMessage({
        type: 'TRANSCRIPTION_ERROR',
        error: 'not-allowed',
        message: 'マイクへのアクセスが拒否されました'
      });
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
    // まだ文字起こし中なら再開
    if (isTranscribing) {
      try {
        speechRecognition.start();
      } catch (e) {}
    }
  };

  try {
    speechRecognition.start();
    console.log('[Offscreen] Transcription started');
    return { success: true };
  } catch (e) {
    console.error('[Offscreen] Failed to start transcription:', e);
    isTranscribing = false;
    return { success: false, error: e.message };
  }
}

/**
 * 文字起こしを停止
 */
function stopTranscription() {
  isTranscribing = false;
  if (speechRecognition) {
    try {
      speechRecognition.stop();
    } catch (e) {}
    speechRecognition = null;
  }
  console.log('[Offscreen] Transcription stopped');
  return { success: true, transcript: transcriptText };
}

/**
 * 現在の文字起こしテキストを取得
 */
function getTranscript() {
  return { success: true, transcript: transcriptText, isTranscribing };
}

// 初期化を開始
initDetector();

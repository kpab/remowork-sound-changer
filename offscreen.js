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
 * 2点間の距離を計算
 */
function distance(p1, p2) {
  return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
}

/**
 * 手のランドマークからジェスチャーを検出
 *
 * MediaPipe Hand Landmarks:
 * 0: WRIST
 * 1-4: THUMB (CMC, MCP, IP, TIP)
 * 5-8: INDEX (MCP, PIP, DIP, TIP)
 * 9-12: MIDDLE (MCP, PIP, DIP, TIP)
 * 13-16: RING (MCP, PIP, DIP, TIP)
 * 17-20: PINKY (MCP, PIP, DIP, TIP)
 *
 * 検出対象ジェスチャー（片手）:
 * 1. Thumbs Up 👍: 親指が上向き + 4本指が閉じている
 * 2. Peace ✌️: 人差し指と中指が伸びている + 他が閉じている
 * 3. Open Palm 👋: 複数のパターンで検出
 *    - パターンA: 4本指が伸びている（指先がPIPより上）
 *    - パターンB: 指が揃っている（隣接する指先の距離が近い）
 *    - パターンC: 3本以上の指が伸びている
 *
 * 両手ジェスチャー（detectHeadInHands関数で検出）:
 * - Head in Hands 😢: 両手が顔の両側にある（頭を抱えるポーズ）
 */
function detectGesture(landmarks) {
  if (!landmarks || landmarks.length === 0) return null;

  // 各指のランドマーク
  const wrist = landmarks[0];

  // 親指
  const thumbTip = landmarks[4];
  const thumbIP = landmarks[3];
  const thumbMCP = landmarks[2];
  const thumbExtended = Math.abs(thumbTip.x - wrist.x) > Math.abs(thumbIP.x - wrist.x);
  const thumbUp = thumbTip.y < thumbMCP.y - 0.05;

  // 人差し指
  const indexTip = landmarks[8];
  const indexPIP = landmarks[6];
  const indexMCP = landmarks[5];
  const indexExtended = indexTip.y < indexPIP.y - 0.02;

  // 中指
  const middleTip = landmarks[12];
  const middlePIP = landmarks[10];
  const middleMCP = landmarks[9];
  const middleExtended = middleTip.y < middlePIP.y - 0.02;

  // 薬指
  const ringTip = landmarks[16];
  const ringPIP = landmarks[14];
  const ringMCP = landmarks[13];
  const ringExtended = ringTip.y < ringPIP.y - 0.02;

  // 小指
  const pinkyTip = landmarks[20];
  const pinkyPIP = landmarks[18];
  const pinkyMCP = landmarks[17];
  const pinkyExtended = pinkyTip.y < pinkyPIP.y - 0.02;

  // 4本指の状態
  const fourFingersClosed = !indexExtended && !middleExtended && !ringExtended && !pinkyExtended;
  const fourFingersOpen = indexExtended && middleExtended && ringExtended && pinkyExtended;

  // 親指が下を向いているか（y座標がMCPより下）
  const thumbDown = thumbTip.y > thumbMCP.y + 0.05;

  // === Thumbs Up 検出 ===
  // 親指が立っていて、他の4本指が閉じている
  if (thumbUp && thumbExtended && fourFingersClosed) {
    console.log('[Offscreen] Detected: Thumbs Up');
    return { type: 'thumbsup', emoji: '👍', message: 'いつでもお話しいいですよ！！' };
  }

  // === Peace 検出 ===
  // 人差し指と中指が伸びていて、薬指と小指が閉じている
  const peaceSign = indexExtended && middleExtended && !ringExtended && !pinkyExtended;
  if (peaceSign) {
    console.log('[Offscreen] Detected: Peace');
    return { type: 'peace', emoji: '✌️', message: '調子いいから聞いて聞いて！！！' };
  }

  // === Open Palm 検出（複数パターン） ===

  // パターンA: 4本指が伸びている（従来の検出）
  if (fourFingersOpen) {
    console.log('[Offscreen] Detected: Open Palm (Pattern A: fingers extended)');
    return { type: 'wave', emoji: '👋', message: 'お話ししたいです！！！' };
  }

  // パターンB: 指が揃っている（閉じた手のひら）
  // 隣接する指先の距離が近い = 指が揃っている
  const indexMiddleDist = distance(indexTip, middleTip);
  const middleRingDist = distance(middleTip, ringTip);
  const ringPinkyDist = distance(ringTip, pinkyTip);
  const avgFingerTipDist = (indexMiddleDist + middleRingDist + ringPinkyDist) / 3;

  // 手のひらの幅（人差し指MCPから小指MCPまで）
  const palmWidth = distance(indexMCP, pinkyMCP);

  // 指先が揃っている（隣接指先の平均距離が手のひら幅の25%以下）
  const fingersAligned = avgFingerTipDist < palmWidth * 0.25;

  // 指がある程度伸びている（MCPから指先までの距離）
  const indexLength = distance(indexMCP, indexTip);
  const middleLength = distance(middleMCP, middleTip);
  const ringLength = distance(ringMCP, ringTip);
  const pinkyLength = distance(pinkyMCP, pinkyTip);
  const avgFingerLength = (indexLength + middleLength + ringLength + pinkyLength) / 4;

  // 指の長さが手のひら幅の40%以上ならある程度伸びている
  const fingersLongEnough = avgFingerLength > palmWidth * 0.4;

  // パターンB: 指が揃っていて、ある程度伸びている
  if (fingersAligned && fingersLongEnough) {
    console.log('[Offscreen] Detected: Open Palm (Pattern B: fingers aligned)');
    return { type: 'wave', emoji: '👋', message: 'お話ししたいです！！！' };
  }

  // パターンC: 手のひらが正面を向いている（少なくとも3本の指が伸びている）
  const extendedCount = [indexExtended, middleExtended, ringExtended, pinkyExtended].filter(Boolean).length;
  if (extendedCount >= 3 && fingersLongEnough) {
    console.log('[Offscreen] Detected: Open Palm (Pattern C: 3+ fingers extended)');
    return { type: 'wave', emoji: '👋', message: 'お話ししたいです！！！' };
  }

  // それ以外のジェスチャーは無視
  console.log('[Offscreen] No recognized gesture (extended:', extendedCount, 'aligned:', fingersAligned,
    'longEnough:', fingersLongEnough, 'thumbUp:', thumbUp, ')');
  return null;
}

/**
 * 両手で「頭を抱える」ジェスチャーを検出
 * 条件:
 * - 両手が検出されている
 * - 両手の手首が画像の上部にある（顔の近く）
 * - 両手の手首が離れている（頭の両側）
 */
function detectHeadInHands(landmarks1, landmarks2) {
  const wrist1 = landmarks1[0];
  const wrist2 = landmarks2[0];

  // 両手首のY座標が画像上部にある（0.0〜0.5の範囲、上が0）
  const bothHandsHigh = wrist1.y < 0.5 && wrist2.y < 0.5;

  // 両手首のX座標が離れている（左右に広がっている）
  const handsSpread = Math.abs(wrist1.x - wrist2.x) > 0.3;

  // 両手首が画像の両端にある（左手は左側、右手は右側）
  const leftHand = wrist1.x < 0.5 ? landmarks1 : landmarks2;
  const rightHand = wrist1.x < 0.5 ? landmarks2 : landmarks1;
  const properPosition = leftHand[0].x < 0.5 && rightHand[0].x > 0.5;

  // 指の状態をチェック（開いている or 閉じている、どちらでもOK）
  // 頭を抱える時は指が開いていることが多い

  if (bothHandsHigh && handsSpread && properPosition) {
    console.log('[Offscreen] Detected: Head in Hands (両手で頭を抱える)');
    return { type: 'head_in_hands', emoji: '😢', message: '調子悪いので慰めて。。。；；' };
  }

  return null;
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

    // 両手が検出された場合、「頭を抱える」ジェスチャーをチェック
    if (results.landmarks.length >= 2) {
      const headInHandsGesture = detectHeadInHands(
        results.landmarks[0],
        results.landmarks[1]
      );
      if (headInHandsGesture) {
        return { success: true, gesture: headInHandsGesture };
      }
    }

    // 片手のジェスチャーをチェック
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
let lastInterimTranscript = ''; // 最後の暫定結果を保持
let networkErrorRetryCount = 0;
const MAX_NETWORK_RETRIES = 3;
const NETWORK_RETRY_DELAY = 2000; // 2秒待ってリトライ

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
  lastInterimTranscript = '';
  isTranscribing = true;
  networkErrorRetryCount = 0;

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
      networkErrorRetryCount++;
      console.log(`[Offscreen] Network error, retry ${networkErrorRetryCount}/${MAX_NETWORK_RETRIES}`);

      if (networkErrorRetryCount <= MAX_NETWORK_RETRIES && isTranscribing) {
        // 再接続中のメッセージを文字起こしに追加
        const retryMessage = `\n[⏳ 再接続中... (${networkErrorRetryCount}/${MAX_NETWORK_RETRIES})]\n`;
        chrome.runtime.sendMessage({
          type: 'TRANSCRIPTION_RESULT',
          transcript: transcriptText + retryMessage,
          interim: '',
          isFinal: false
        });

        // 少し待ってから再接続を試みる
        setTimeout(() => {
          if (isTranscribing && speechRecognition) {
            try {
              speechRecognition.start();
              console.log('[Offscreen] Reconnected after network error');
              // 再接続成功メッセージを追加
              transcriptText += `\n[✓ 再接続成功]\n`;
              chrome.runtime.sendMessage({
                type: 'TRANSCRIPTION_RESULT',
                transcript: transcriptText,
                interim: '',
                isFinal: false
              });
              networkErrorRetryCount = 0;
            } catch (e) {
              console.warn('[Offscreen] Reconnection failed:', e);
            }
          }
        }, NETWORK_RETRY_DELAY);
        return;
      }

      // リトライ上限に達した場合はエラーメッセージを文字起こしに追加
      const errorMessage = `\n[❌ ネットワークエラー：再接続に失敗しました]\n`;
      transcriptText += errorMessage;
      isTranscribing = false;
      chrome.runtime.sendMessage({
        type: 'TRANSCRIPTION_ERROR',
        error: 'network',
        message: 'ネットワークエラー：文字起こし利用不可',
        transcript: transcriptText
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
    // 再起動前に暫定結果があれば確定として保存
    if (lastInterimTranscript) {
      transcriptText += lastInterimTranscript + '\n';
      lastInterimTranscript = '';
      // 更新を通知
      chrome.runtime.sendMessage({
        type: 'TRANSCRIPTION_RESULT',
        transcript: transcriptText,
        interim: '',
        isFinal: true
      });
    }

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

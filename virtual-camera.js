/**
 * Remowork Virtual Camera
 * getUserMedia をフックして登録画像を仮想カメラとして送信
 * 隠し機能: ハンドサイン画像を撮影前に自動送信
 */

(function() {
  'use strict';

  // 二重実行防止
  if (window.__remoworkVirtualCameraInjected) return;
  window.__remoworkVirtualCameraInjected = true;

  // 仮想カメラ状態
  let virtualCameraEnabled = false;
  let currentVirtualImage = null; // Base64 画像データ
  let virtualCanvas = null;
  let virtualStream = null;
  let originalGetUserMedia = null;

  // ジェスチャータイプ一覧
  const GESTURE_TYPES = ['wave', 'thumbsup', 'peace', 'head_in_hands'];

  // 登録済み画像（ストレージから読み込み）- 配列形式
  let registeredImages = {
    wave: [],           // 👋 (最大12枚)
    thumbsup: [],       // 👍 (最大12枚)
    peace: [],          // ✌️ (最大12枚)
    head_in_hands: []   // 😢 (最大12枚)
  };

  // デフォルト画像（拡張機能のリソース）
  let defaultImages = {
    wave: null,
    thumbsup: null,
    peace: null,
    head_in_hands: null
  };

  // 描画用interval ID（メモリリーク防止用）
  let currentDrawInterval = null;

  console.log('[VirtualCamera] Initializing...');

  // 現在描画中の画像（リアルタイム更新用）
  let currentDrawingImage = null;
  let lastDrawnImageSrc = null;

  /**
   * Canvas から MediaStream を生成
   */
  function createVirtualStream(imageData, width = 640, height = 480) {
    if (!virtualCanvas) {
      virtualCanvas = document.createElement('canvas');
    }
    virtualCanvas.width = width;
    virtualCanvas.height = height;

    const ctx = virtualCanvas.getContext('2d');

    // 初期画像を設定
    currentDrawingImage = new Image();
    lastDrawnImageSrc = imageData;
    currentDrawingImage.src = imageData;

    currentDrawingImage.onload = () => {
      // 画像をキャンバスに描画（アスペクト比を維持してセンタリング）
      const scale = Math.min(width / currentDrawingImage.width, height / currentDrawingImage.height);
      const x = (width - currentDrawingImage.width * scale) / 2;
      const y = (height - currentDrawingImage.height * scale) / 2;

      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(currentDrawingImage, x, y, currentDrawingImage.width * scale, currentDrawingImage.height * scale);
    };

    // 既存のintervalをクリア（メモリリーク防止）
    if (currentDrawInterval) {
      clearInterval(currentDrawInterval);
      currentDrawInterval = null;
    }

    // 定期的に再描画（静止画でもストリームを維持 + 画像の動的更新）
    currentDrawInterval = setInterval(() => {
      if (!virtualCameraEnabled) {
        clearInterval(currentDrawInterval);
        currentDrawInterval = null;
        return;
      }

      // currentVirtualImage が変更されていたら新しい画像を読み込む
      if (currentVirtualImage && currentVirtualImage !== lastDrawnImageSrc) {
        console.log('[VirtualCamera] Detected image change, updating canvas');
        lastDrawnImageSrc = currentVirtualImage;
        currentDrawingImage = new Image();
        currentDrawingImage.src = currentVirtualImage;
      }

      if (currentDrawingImage && currentDrawingImage.complete && currentDrawingImage.naturalWidth > 0) {
        const scale = Math.min(width / currentDrawingImage.width, height / currentDrawingImage.height);
        const x = (width - currentDrawingImage.width * scale) / 2;
        const y = (height - currentDrawingImage.height * scale) / 2;
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(currentDrawingImage, x, y, currentDrawingImage.width * scale, currentDrawingImage.height * scale);
      }
    }, 100); // 10fps で更新

    return virtualCanvas.captureStream(10);
  }

  /**
   * getUserMedia をフック
   */
  function hookGetUserMedia() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      console.log('[VirtualCamera] getUserMedia not available');
      return;
    }

    originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);

    navigator.mediaDevices.getUserMedia = async function(constraints) {
      console.log('[VirtualCamera] getUserMedia called', constraints, 'virtualEnabled:', virtualCameraEnabled);

      // 仮想カメラが有効で、ビデオが要求されている場合
      if (virtualCameraEnabled && constraints && constraints.video && currentVirtualImage) {
        console.log('[VirtualCamera] Returning virtual camera stream');

        try {
          // 仮想ストリームを作成
          virtualStream = createVirtualStream(currentVirtualImage);

          // 音声も要求されている場合は、実際のマイクストリームを取得して追加
          if (constraints.audio) {
            const audioStream = await originalGetUserMedia({ audio: constraints.audio });
            const audioTracks = audioStream.getAudioTracks();
            audioTracks.forEach(track => virtualStream.addTrack(track));
          }

          return virtualStream;
        } catch (error) {
          console.error('[VirtualCamera] Failed to create virtual stream:', error);
          // フォールバック: 通常のカメラを返す
          return originalGetUserMedia(constraints);
        }
      }

      // 通常のカメラを返す
      return originalGetUserMedia(constraints);
    };

    console.log('[VirtualCamera] getUserMedia hooked');
  }

  /**
   * 配列からランダムに1つ選択
   */
  function getRandomImage(images) {
    if (!images || images.length === 0) return null;
    const index = Math.floor(Math.random() * images.length);
    console.log(`[VirtualCamera] Selected image ${index + 1}/${images.length}`);
    return images[index];
  }

  /**
   * 仮想カメラを有効化
   */
  function enableVirtualCamera(imageType) {
    let imageData = null;

    // 登録済み画像から取得
    if (GESTURE_TYPES.includes(imageType) && registeredImages[imageType] && registeredImages[imageType].length > 0) {
      // 配列からランダムに選択
      imageData = getRandomImage(registeredImages[imageType]);
    } else if (typeof imageType === 'string' && imageType.startsWith('data:')) {
      // 直接Base64データが渡された場合
      imageData = imageType;
    }

    // デフォルト画像にフォールバック
    if (!imageData && GESTURE_TYPES.includes(imageType)) {
      imageData = defaultImages[imageType];
      if (imageData) {
        console.log('[VirtualCamera] Using default image for type:', imageType);
      }
    }

    if (imageData) {
      currentVirtualImage = imageData;
      virtualCameraEnabled = true;
      console.log('[VirtualCamera] Enabled with image type:', imageType);

      // 既存のストリームがある場合は、新しい画像で再作成
      if (virtualStream) {
        console.log('[VirtualCamera] Updating existing stream with new image');
        // 古いストリームを停止
        virtualStream.getTracks().forEach(track => track.stop());
        // 新しいストリームを作成（次回のgetUserMedia呼び出しで使用される）
        virtualStream = createVirtualStream(currentVirtualImage);
      }

      return true;
    }

    console.log('[VirtualCamera] No image found for type:', imageType);
    return false;
  }

  /**
   * 仮想カメラを無効化
   */
  function disableVirtualCamera() {
    virtualCameraEnabled = false;
    currentVirtualImage = null;

    // 仮想ストリームを停止
    if (virtualStream) {
      virtualStream.getTracks().forEach(track => track.stop());
      virtualStream = null;
    }

    console.log('[VirtualCamera] Disabled');
  }

  /**
   * 画像を登録（配列に追加）
   */
  function registerImage(type, imageData) {
    if (GESTURE_TYPES.includes(type)) {
      if (!registeredImages[type]) registeredImages[type] = [];
      registeredImages[type].push(imageData);
      console.log('[VirtualCamera] Image registered:', type, `(${registeredImages[type].length} total)`);
    } else {
      console.warn('[VirtualCamera] Unknown image type:', type);
    }
  }

  /**
   * メッセージハンドラー（Content Script からの通信用）
   */
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (!event.data || event.data.source !== 'remowork-virtual-camera') return;

    const { type, payload } = event.data;

    switch (type) {
      case 'ENABLE_VIRTUAL_CAMERA':
        enableVirtualCamera(payload.imageType);
        break;

      case 'DISABLE_VIRTUAL_CAMERA':
        disableVirtualCamera();
        break;

      case 'REGISTER_IMAGE':
        registerImage(payload.type, payload.imageData);
        break;

      case 'GET_STATUS':
        const imageCounts = {};
        for (const type of GESTURE_TYPES) {
          imageCounts[type] = registeredImages[type]?.length || 0;
        }
        window.postMessage({
          source: 'remowork-virtual-camera-response',
          type: 'STATUS',
          payload: {
            enabled: virtualCameraEnabled,
            imageCounts: imageCounts,
            // 後方互換性
            waveCount: registeredImages.wave?.length || 0,
            thumbsupCount: registeredImages.thumbsup?.length || 0
          }
        }, '*');
        break;

      case 'LOAD_IMAGES':
        // ストレージから画像を読み込む（配列形式）
        if (payload.images) {
          // 全ジェスチャータイプを読み込み
          for (const type of GESTURE_TYPES) {
            if (payload.images[type]) {
              // 旧形式（単一画像）との互換性
              if (!Array.isArray(payload.images[type])) {
                registeredImages[type] = [payload.images[type]];
              } else {
                registeredImages[type] = payload.images[type];
              }
            } else {
              registeredImages[type] = [];
            }
          }
          const counts = {};
          for (const type of GESTURE_TYPES) {
            counts[type] = registeredImages[type].length;
          }
          console.log('[VirtualCamera] Images loaded from storage:', counts);
        }
        break;

      case 'SET_DEFAULT_IMAGES':
        // デフォルト画像を設定（Base64形式）
        for (const type of GESTURE_TYPES) {
          if (payload[type]) {
            defaultImages[type] = payload[type];
          }
        }
        const defaultSet = {};
        for (const type of GESTURE_TYPES) {
          defaultSet[type] = !!defaultImages[type];
        }
        console.log('[VirtualCamera] Default images set:', defaultSet);
        break;
    }
  });

  // getUserMedia をフック
  hookGetUserMedia();

  // グローバルに公開（デバッグ用、隠し機能）
  window.__remoworkVirtualCamera = {
    enable: enableVirtualCamera,
    disable: disableVirtualCamera,
    register: registerImage,
    status: () => ({
      enabled: virtualCameraEnabled,
      waveCount: registeredImages.wave?.length || 0,
      thumbsupCount: registeredImages.thumbsup?.length || 0
    })
  };

  console.log('[VirtualCamera] Ready - Access via window.__remoworkVirtualCamera');
})();

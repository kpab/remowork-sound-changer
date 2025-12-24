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

  // 登録済み画像（ストレージから読み込み）- 配列形式
  let registeredImages = {
    wave: [],      // 👋 (最大12枚)
    thumbsup: []   // 👍 (最大12枚)
  };

  console.log('[VirtualCamera] Initializing...');

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
    const img = new Image();

    img.onload = () => {
      // 画像をキャンバスに描画（アスペクト比を維持してセンタリング）
      const scale = Math.min(width / img.width, height / img.height);
      const x = (width - img.width * scale) / 2;
      const y = (height - img.height * scale) / 2;

      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, x, y, img.width * scale, img.height * scale);
    };
    img.src = imageData;

    // 定期的に再描画（静止画でもストリームを維持）
    const drawInterval = setInterval(() => {
      if (!virtualCameraEnabled) {
        clearInterval(drawInterval);
        return;
      }
      if (img.complete) {
        const scale = Math.min(width / img.width, height / img.height);
        const x = (width - img.width * scale) / 2;
        const y = (height - img.height * scale) / 2;
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, x, y, img.width * scale, img.height * scale);
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

    if (imageType === 'wave' && registeredImages.wave && registeredImages.wave.length > 0) {
      // 配列からランダムに選択
      imageData = getRandomImage(registeredImages.wave);
    } else if (imageType === 'thumbsup' && registeredImages.thumbsup && registeredImages.thumbsup.length > 0) {
      // 配列からランダムに選択
      imageData = getRandomImage(registeredImages.thumbsup);
    } else if (typeof imageType === 'string' && imageType.startsWith('data:')) {
      // 直接Base64データが渡された場合
      imageData = imageType;
    }

    if (imageData) {
      currentVirtualImage = imageData;
      virtualCameraEnabled = true;
      console.log('[VirtualCamera] Enabled with image type:', imageType);
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
    if (type === 'wave') {
      if (!registeredImages.wave) registeredImages.wave = [];
      registeredImages.wave.push(imageData);
    } else if (type === 'thumbsup') {
      if (!registeredImages.thumbsup) registeredImages.thumbsup = [];
      registeredImages.thumbsup.push(imageData);
    }
    console.log('[VirtualCamera] Image registered:', type, `(${registeredImages[type]?.length || 0} total)`);
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
        window.postMessage({
          source: 'remowork-virtual-camera-response',
          type: 'STATUS',
          payload: {
            enabled: virtualCameraEnabled,
            waveCount: registeredImages.wave?.length || 0,
            thumbsupCount: registeredImages.thumbsup?.length || 0
          }
        }, '*');
        break;

      case 'LOAD_IMAGES':
        // ストレージから画像を読み込む（配列形式）
        if (payload.images) {
          // 旧形式（単一画像）との互換性
          if (payload.images.wave && !Array.isArray(payload.images.wave)) {
            registeredImages.wave = [payload.images.wave];
          } else {
            registeredImages.wave = payload.images.wave || [];
          }
          if (payload.images.thumbsup && !Array.isArray(payload.images.thumbsup)) {
            registeredImages.thumbsup = [payload.images.thumbsup];
          } else {
            registeredImages.thumbsup = payload.images.thumbsup || [];
          }
          console.log('[VirtualCamera] Images loaded from storage:', {
            wave: registeredImages.wave.length,
            thumbsup: registeredImages.thumbsup.length
          });
        }
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

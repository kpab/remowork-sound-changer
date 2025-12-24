/**
 * Remowork Sound Changer - Content Script
 * inject.js をページコンテキストに注入し、音声設定を伝達
 */

(function() {
  'use strict';

  // 二重実行防止
  if (window.__remoworkSoundChangerLoaded) return;
  window.__remoworkSoundChangerLoaded = true;

  /**
   * 音声設定を取得してページに伝達
   */
  async function loadAndInjectConfig() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_SOUND_CONFIG' });

      if (!response.success) {
        console.error('[RemoworkSoundChanger] Failed to get config:', response.error);
        return;
      }

      const config = response.data;

      // 無効化されている場合は何もしない
      if (!config.enabled) {
        console.log('[RemoworkSoundChanger] Extension is disabled');
        return;
      }

      // 設定をページに伝達
      injectConfig(config);

      // inject.js を注入
      injectScript();

      // virtual-camera.js を注入（隠し機能）
      injectVirtualCamera();

    } catch (error) {
      console.error('[RemoworkSoundChanger] Error:', error);
    }
  }

  /**
   * 設定をページコンテキストに渡す（CSP対応: data属性を使用）
   */
  function injectConfig(config) {
    // CSP対策: インラインスクリプトではなくdata属性で設定を渡す
    const configElement = document.createElement('div');
    configElement.id = '__remoworkSoundConfig';
    configElement.style.display = 'none';
    configElement.dataset.config = JSON.stringify(config);
    (document.head || document.documentElement).appendChild(configElement);
  }

  /**
   * inject.js をページコンテキストに注入
   */
  function injectScript() {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('inject.js');
    script.onload = function() {
      this.remove();
    };
    (document.head || document.documentElement).appendChild(script);
  }

  /**
   * virtual-camera.js をページコンテキストに注入
   */
  function injectVirtualCamera() {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('virtual-camera.js');
    script.onload = function() {
      this.remove();
      // ストレージから登録済み画像を読み込んで渡す
      loadVirtualCameraImages();
    };
    (document.head || document.documentElement).appendChild(script);
  }

  /**
   * 仮想カメラ用の画像をストレージから読み込み
   */
  async function loadVirtualCameraImages() {
    try {
      const result = await chrome.storage.local.get(['virtualCameraImages']);
      if (result.virtualCameraImages) {
        window.postMessage({
          source: 'remowork-virtual-camera',
          type: 'LOAD_IMAGES',
          payload: { images: result.virtualCameraImages }
        }, '*');
      }

      // デフォルト画像を読み込んで設定
      loadDefaultImages();
    } catch (error) {
      console.error('[RemoworkSoundChanger] Failed to load virtual camera images:', error);
    }
  }

  /**
   * デフォルト画像を読み込んでvirtual-camera.jsに送信
   */
  async function loadDefaultImages() {
    const defaultImageTypes = ['wave', 'thumbsup'];
    const defaultImages = {};

    for (const type of defaultImageTypes) {
      try {
        const url = chrome.runtime.getURL(`images/defaults/${type}.png`);
        const response = await fetch(url);
        if (response.ok) {
          const blob = await response.blob();
          const base64 = await blobToBase64(blob);
          defaultImages[type] = base64;
        }
      } catch (error) {
        // デフォルト画像が存在しない場合は無視
        console.log(`[RemoworkSoundChanger] No default image for ${type}`);
      }
    }

    // デフォルト画像が1つでもあれば送信
    if (Object.keys(defaultImages).length > 0) {
      window.postMessage({
        source: 'remowork-virtual-camera',
        type: 'SET_DEFAULT_IMAGES',
        payload: defaultImages
      }, '*');
      console.log('[RemoworkSoundChanger] Default images loaded:', Object.keys(defaultImages));
    }
  }

  /**
   * BlobをBase64に変換
   */
  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  /**
   * 設定変更を監視してページに伝達
   */
  chrome.storage.onChanged.addListener(async (changes, areaName) => {
    if (areaName === 'local' && changes.settings) {
      // 設定が変更されたらページに通知
      try {
        const response = await chrome.runtime.sendMessage({ type: 'GET_SOUND_CONFIG' });
        if (response.success) {
          window.postMessage({
            source: 'remowork-sound-changer-content',
            type: 'CONFIG_UPDATED',
            config: response.data
          }, '*');
        }
      } catch (error) {
        console.error('[RemoworkSoundChanger] Failed to send config update:', error);
      }
    }
  });

  /**
   * ページからのメッセージを受信（音声データ取得用）
   */
  window.addEventListener('message', async (event) => {
    if (event.source !== window) return;
    if (!event.data || event.data.source !== 'remowork-sound-changer-inject') return;

    const { type, id, requestId } = event.data;

    if (type === 'GET_CUSTOM_SOUND') {
      try {
        const response = await chrome.runtime.sendMessage({ type: 'GET_SOUND', id });

        window.postMessage({
          source: 'remowork-sound-changer-content',
          requestId,
          success: response.success,
          data: response.data
        }, '*');
      } catch (error) {
        window.postMessage({
          source: 'remowork-sound-changer-content',
          requestId,
          success: false,
          error: error.message
        }, '*');
      }
    }
  });

  // 初期化
  loadAndInjectConfig();
})();

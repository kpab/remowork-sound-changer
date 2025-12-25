/**
 * chrome-extension:// URL用のfetchポリフィル
 * face-api.jsがfetchを使用するため、face-api.jsより前に読み込む必要がある
 */
(function() {
  'use strict';

  console.log('[FetchPolyfill] ====== SCRIPT LOADED ======');
  console.log('[FetchPolyfill] Initializing...');
  console.log('[FetchPolyfill] chrome.runtime available:', typeof chrome !== 'undefined' && !!chrome.runtime);

  // 元のfetchを保存
  const originalFetch = window.fetch ? window.fetch.bind(window) : null;
  console.log('[FetchPolyfill] Original fetch exists:', !!originalFetch);

  window.fetch = async function(input, options) {
    let url;
    try {
      url = typeof input === 'string' ? input : (input instanceof Request ? input.url : String(input));
    } catch (e) {
      console.error('[FetchPolyfill] Failed to parse input:', input, e);
      throw e;
    }

    console.log('[FetchPolyfill] fetch() called for:', url?.substring(0, 100));

    // chrome-extension: で始まるURLをすべて処理（スラッシュの数に関係なく）
    // face-api.jsが内部でURLを構築する際にスラッシュが1つになることがある
    if (url && url.startsWith('chrome-extension:')) {
      // URLを正規化（chrome-extension:/ を chrome-extension:// に修正）
      if (url.startsWith('chrome-extension:/') && !url.startsWith('chrome-extension://')) {
        url = url.replace('chrome-extension:/', 'chrome-extension://');
        console.log('[FetchPolyfill] URL normalized to:', url.substring(0, 100));
      }
      console.log('[FetchPolyfill] Using XHR for chrome-extension URL');
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', url, true);

        // ファイル拡張子に基づいてresponseTypeを設定
        const isJson = url.endsWith('.json');
        xhr.responseType = isJson ? 'text' : 'arraybuffer';
        console.log('[FetchPolyfill] XHR responseType:', xhr.responseType);

        xhr.onload = () => {
          console.log('[FetchPolyfill] XHR onload, status:', xhr.status);
          if (xhr.status === 200 || xhr.status === 0) {
            const contentType = isJson ? 'application/json' : 'application/octet-stream';
            const body = isJson ? xhr.responseText : xhr.response;
            console.log('[FetchPolyfill] XHR success, body size:', isJson ? body.length : body.byteLength);
            resolve(new Response(body, {
              status: 200,
              headers: { 'Content-Type': contentType }
            }));
          } else {
            console.error('[FetchPolyfill] XHR HTTP error:', xhr.status);
            reject(new Error('HTTP ' + xhr.status));
          }
        };

        xhr.onerror = function(e) {
          console.error('[FetchPolyfill] XHR error for:', url, 'error:', e);
          reject(new Error('XHR failed for ' + url));
        };

        xhr.ontimeout = function() {
          console.error('[FetchPolyfill] XHR timeout for:', url);
          reject(new Error('XHR timeout for ' + url));
        };

        console.log('[FetchPolyfill] Sending XHR request...');
        xhr.send();
      });
    }

    // chrome-extension:// 以外のURLは元のfetchを使用
    if (originalFetch) {
      console.log('[FetchPolyfill] Using original fetch for:', url?.substring(0, 50));
      return originalFetch(input, options);
    } else {
      console.error('[FetchPolyfill] No original fetch available for:', url);
      throw new Error('Fetch not available for: ' + url);
    }
  };

  console.log('[FetchPolyfill] Fetch polyfill installed successfully');
  console.log('[FetchPolyfill] window.fetch is now:', typeof window.fetch);
})();

/**
 * Remowork Sound Changer - MP3 Converter
 * WebM形式の音声をMP3に変換（オフスクリーンドキュメント経由）
 */

(function() {
  'use strict';

  /**
   * オフスクリーンドキュメント経由でBlobをMP3に変換
   * @param {Blob} blob - WebM形式の音声Blob
   * @returns {Promise<Blob>} MP3形式のBlob
   */
  async function convertToMp3(blob) {
    // BlobをArrayBufferに変換
    const arrayBuffer = await blob.arrayBuffer();

    console.log('[MP3Converter] Sending to offscreen, size:', arrayBuffer.byteLength);

    // オフスクリーンドキュメントに送信
    const result = await chrome.runtime.sendMessage({
      type: 'CONVERT_TO_MP3',
      audioData: Array.from(new Uint8Array(arrayBuffer))
    });

    if (!result || !result.success) {
      throw new Error(result?.error || 'MP3変換に失敗しました');
    }

    // 結果をBlobに変換
    const mp3Array = new Uint8Array(result.mp3Data);
    console.log('[MP3Converter] Conversion complete, size:', mp3Array.length);

    return new Blob([mp3Array], { type: 'audio/mp3' });
  }

  /**
   * 録音データをMP3としてダウンロード
   * @param {Object} recording - 録音データオブジェクト（blob, nameプロパティ必須）
   * @param {Function} onProgress - 進捗コールバック（'converting', 'complete', 'error'）
   */
  async function downloadAsMp3(recording, onProgress = () => {}) {
    if (!recording || !recording.blob) {
      throw new Error('録音データがありません');
    }

    try {
      onProgress('converting');

      // オフスクリーン経由でMP3に変換
      const mp3Blob = await convertToMp3(recording.blob);

      // ダウンロード
      const url = URL.createObjectURL(mp3Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${recording.name || 'recording'}.mp3`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      console.log('[MP3Converter] Downloaded:', recording.name);
      onProgress('complete');

    } catch (error) {
      console.error('[MP3Converter] Download failed:', error);
      onProgress('error', error.message);
      throw error;
    }
  }

  // グローバルに公開
  window.MP3Converter = {
    convert: convertToMp3,
    download: downloadAsMp3
  };

})();

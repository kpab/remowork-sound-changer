/**
 * Remowork Sound Changer - Recordings Database
 * IndexedDBを使用した録音データの永続化管理
 */

(function() {
  'use strict';

  const RECORDINGS_DB_NAME = 'HandSignRecordings';
  const RECORDINGS_STORE_NAME = 'recordings';

  let recordingsDb = null;

  /**
   * IndexedDBを初期化
   */
  async function initRecordingsDb() {
    if (recordingsDb) return recordingsDb;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(RECORDINGS_DB_NAME, 1);

      request.onerror = () => {
        console.error('[RecordingsDB] Failed to open DB:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        recordingsDb = request.result;
        console.log('[RecordingsDB] DB opened');
        resolve(recordingsDb);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(RECORDINGS_STORE_NAME)) {
          const store = db.createObjectStore(RECORDINGS_STORE_NAME, { keyPath: 'id' });
          store.createIndex('date', 'date', { unique: false });
          console.log('[RecordingsDB] Store created');
        }
      };
    });
  }

  /**
   * 録音データをIndexedDBに保存
   * @param {Object} recording - 録音データオブジェクト
   */
  async function saveRecordingToDb(recording) {
    try {
      const db = await initRecordingsDb();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction([RECORDINGS_STORE_NAME], 'readwrite');
        const store = transaction.objectStore(RECORDINGS_STORE_NAME);
        const request = store.put(recording);

        request.onsuccess = () => {
          console.log('[RecordingsDB] Recording saved:', recording.id);
          resolve();
        };
        request.onerror = () => {
          console.error('[RecordingsDB] Failed to save recording:', request.error);
          reject(request.error);
        };
      });
    } catch (e) {
      console.error('[RecordingsDB] DB error:', e);
    }
  }

  /**
   * 全ての録音データをIndexedDBから読み込み
   * @returns {Array} 録音データの配列（新しい順）
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
          console.log('[RecordingsDB] Loaded recordings:', data.length);
          resolve(data);
        };
        request.onerror = () => {
          console.error('[RecordingsDB] Failed to load recordings:', request.error);
          reject(request.error);
        };
      });
    } catch (e) {
      console.error('[RecordingsDB] DB error:', e);
      return [];
    }
  }

  /**
   * 録音データをIndexedDBから削除
   * @param {number} id - 録音ID
   */
  async function deleteRecordingFromDb(id) {
    try {
      const db = await initRecordingsDb();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction([RECORDINGS_STORE_NAME], 'readwrite');
        const store = transaction.objectStore(RECORDINGS_STORE_NAME);
        const request = store.delete(id);

        request.onsuccess = () => {
          console.log('[RecordingsDB] Recording deleted:', id);
          resolve();
        };
        request.onerror = () => {
          console.error('[RecordingsDB] Failed to delete recording:', request.error);
          reject(request.error);
        };
      });
    } catch (e) {
      console.error('[RecordingsDB] DB error:', e);
    }
  }

  /**
   * 指定日数より古い録音を削除
   * @param {number} days - 日数（デフォルト30日）
   */
  async function cleanupOldRecordings(days = 30) {
    const cutoffTime = Date.now() - (days * 24 * 60 * 60 * 1000);

    try {
      const allRecordings = await loadRecordingsFromDb();
      const oldRecordings = allRecordings.filter(r => r.id < cutoffTime);

      if (oldRecordings.length === 0) return 0;

      console.log(`[RecordingsDB] Cleaning up ${oldRecordings.length} old recordings...`);

      for (const recording of oldRecordings) {
        await deleteRecordingFromDb(recording.id);
      }

      console.log('[RecordingsDB] Old recordings cleaned up');
      return oldRecordings.length;
    } catch (e) {
      console.error('[RecordingsDB] Cleanup error:', e);
      return 0;
    }
  }

  // グローバルに公開
  window.RecordingsDB = {
    init: initRecordingsDb,
    save: saveRecordingToDb,
    loadAll: loadRecordingsFromDb,
    delete: deleteRecordingFromDb,
    cleanup: cleanupOldRecordings
  };

})();

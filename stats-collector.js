/**
 * Remowork Sound Changer - Statistics Collector
 * 使用統計の収集と送信
 */

const STATS_WEBHOOK_URL = 'https://script.google.com/macros/s/AKfycbx5PochgLY-1K-YZDqFIDZu8KaLEyFkP359cE5bc_lAsK_tCzxYLFDQTf4vcu7y1NLa/exec';
const APP_NAME = 'remowork-sound-changer';
const STATS_SEND_INTERVAL_MINUTES = 60; // 1時間ごとに送信

/**
 * 統計データのデフォルト構造
 */
function getDefaultStats() {
  return {
    // 通話関連
    calls: {
      external: { count: 0, totalDurationSec: 0 },
      internal: { count: 0, totalDurationSec: 0 }
    },
    // スクリーンタイム
    screenTime: {
      totalSec: 0,
      activeSec: 0
    },
    // ハンドサイン（種類別）
    handSigns: {
      wave: 0,
      thumbsUp: 0,
      thumbsDown: 0,
      peace: 0,
      ok: 0,
      pointUp: 0,
      rock: 0,
      call: 0,
      openPalm: 0,
      fist: 0
    },
    // 表情分析
    expression: {
      analyzeCount: 0,
      detectSuccessCount: 0
    },
    // 音声カスタマイズ
    soundCustom: {
      changed: 0
    },
    // 文字起こし
    transcription: {
      usageCount: 0,
      totalDurationSec: 0
    },
    // UI操作
    uiClicks: {
      popup_open: 0,
      tab_sound: 0,
      tab_handSign: 0,
      tab_virtualCamera: 0,
      tab_llm: 0,
      btn_sound_play: 0,
      btn_sound_upload: 0,
      btn_handSign_toggle: 0,
      btn_expression_toggle: 0,
      btn_transcription_start: 0,
      btn_transcription_stop: 0,
      btn_camera_capture: 0,
      btn_llm_test: 0
    },
    // エラー
    errors: {
      handSign: 0,
      expression: 0,
      transcription: 0,
      sound: 0,
      network: 0
    },
    // メタデータ
    lastUpdated: null,
    sessionStart: null
  };
}

/**
 * 匿名IDを取得または生成
 */
async function getAnonymousId() {
  const result = await chrome.storage.local.get(['_statsAnonymousId']);
  if (result._statsAnonymousId) {
    return result._statsAnonymousId;
  }

  // 新規ID生成（UUIDv4形式）
  const id = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });

  await chrome.storage.local.set({ _statsAnonymousId: id });
  return id;
}

/**
 * 統計データを取得
 */
async function getStats() {
  const result = await chrome.storage.local.get(['_usageStats']);
  return result._usageStats || getDefaultStats();
}

/**
 * 統計データを保存
 */
async function saveStats(stats) {
  stats.lastUpdated = new Date().toISOString();
  await chrome.storage.local.set({ _usageStats: stats });
}

/**
 * 統計設定を取得
 */
async function getStatsSettings() {
  const result = await chrome.storage.local.get(['statsSettings']);
  return result.statsSettings || {
    enabled: true,  // デフォルトは有効
    lastSentAt: null
  };
}

/**
 * 統計設定を保存
 */
async function saveStatsSettings(settings) {
  await chrome.storage.local.set({ statsSettings: settings });
}

/**
 * 統計を記録（インクリメント）
 */
async function recordStat(category, key, increment = 1) {
  const settings = await getStatsSettings();
  if (!settings.enabled) return;

  const stats = await getStats();

  // セッション開始時刻がなければ設定
  if (!stats.sessionStart) {
    stats.sessionStart = new Date().toISOString();
  }

  // ネストしたプロパティに対応
  if (stats[category] && typeof stats[category] === 'object') {
    if (typeof stats[category][key] === 'number') {
      stats[category][key] += increment;
    } else {
      stats[category][key] = increment;
    }
  }

  await saveStats(stats);
}

/**
 * 統計を記録（値を設定）
 */
async function setStatValue(category, key, value) {
  const settings = await getStatsSettings();
  if (!settings.enabled) return;

  const stats = await getStats();

  if (!stats.sessionStart) {
    stats.sessionStart = new Date().toISOString();
  }

  if (stats[category] && typeof stats[category] === 'object') {
    stats[category][key] = value;
  }

  await saveStats(stats);
}

/**
 * 通話時間を記録
 */
async function recordCallDuration(type, durationSec) {
  const settings = await getStatsSettings();
  if (!settings.enabled) return;

  const stats = await getStats();

  if (!stats.sessionStart) {
    stats.sessionStart = new Date().toISOString();
  }

  if (type === 'external') {
    stats.calls.external.count += 1;
    stats.calls.external.totalDurationSec += durationSec;
  } else if (type === 'internal') {
    stats.calls.internal.count += 1;
    stats.calls.internal.totalDurationSec += durationSec;
  }

  await saveStats(stats);
}

/**
 * スクリーンタイムを記録
 */
async function recordScreenTime(totalSec, activeSec) {
  const settings = await getStatsSettings();
  if (!settings.enabled) return;

  const stats = await getStats();

  stats.screenTime.totalSec += totalSec;
  stats.screenTime.activeSec += activeSec;

  await saveStats(stats);
}

/**
 * 統計データをWebhookに送信
 */
async function sendStatsToWebhook() {
  const settings = await getStatsSettings();
  if (!settings.enabled) {
    console.log('[Stats] Stats collection is disabled');
    return { success: false, reason: 'disabled' };
  }

  try {
    const stats = await getStats();
    const anonymousId = await getAnonymousId();
    const manifest = chrome.runtime.getManifest();

    const payload = {
      appName: APP_NAME,
      anonymousId: anonymousId,
      extensionVersion: manifest.version,
      timestamp: new Date().toISOString(),
      ...stats
    };

    console.log('[Stats] Sending stats:', payload);

    const response = await fetch(STATS_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const result = await response.json();
    console.log('[Stats] Webhook response:', result);

    if (result.success) {
      // 送信成功したら統計をリセット
      await resetStats();

      // 最終送信時刻を更新
      settings.lastSentAt = new Date().toISOString();
      await saveStatsSettings(settings);
    }

    return result;
  } catch (error) {
    console.error('[Stats] Failed to send stats:', error);
    await recordStat('errors', 'network');
    return { success: false, error: error.message };
  }
}

/**
 * 統計データをリセット
 */
async function resetStats() {
  const freshStats = getDefaultStats();
  freshStats.sessionStart = new Date().toISOString();
  await saveStats(freshStats);
  console.log('[Stats] Stats reset');
}

/**
 * 定期送信のアラームをセットアップ
 */
async function setupStatsAlarm() {
  // 既存のアラームをクリア
  await chrome.alarms.clear('sendStats');

  // 1時間ごとに送信
  chrome.alarms.create('sendStats', {
    delayInMinutes: STATS_SEND_INTERVAL_MINUTES,
    periodInMinutes: STATS_SEND_INTERVAL_MINUTES
  });

  console.log('[Stats] Alarm set for every', STATS_SEND_INTERVAL_MINUTES, 'minutes');
}

/**
 * アラームハンドラー
 */
function handleStatsAlarm(alarm) {
  if (alarm.name === 'sendStats') {
    console.log('[Stats] Alarm triggered, sending stats...');
    sendStatsToWebhook();
  }
}

// エクスポート（background.jsから使用）
if (typeof globalThis !== 'undefined') {
  globalThis.StatsCollector = {
    getDefaultStats,
    getAnonymousId,
    getStats,
    saveStats,
    getStatsSettings,
    saveStatsSettings,
    recordStat,
    setStatValue,
    recordCallDuration,
    recordScreenTime,
    sendStatsToWebhook,
    resetStats,
    setupStatsAlarm,
    handleStatsAlarm
  };
}

/**
 * Remowork Sound Changer - Background Service Worker
 * IndexedDB管理、設定の保存・読み込み
 */

const DB_NAME = 'RemoworkSoundChangerDB';
const DB_VERSION = 1;
const STORE_NAME = 'sounds';
const MAX_FILE_SIZE = 300 * 1024 * 1024; // 300MB

// 対象音声ファイルの定義
// 複数のパスで同じ音声が使われる場合はpathsを使用
const SOUND_TYPES = {
  calling: {
    path: '/client/calling.mp3',
    paths: ['/client/calling.mp3', '/sounds/calling.mp3', '/audio/calling.mp3'],
    label: '発信中（呼び出し音）'
  },
  incoming: {
    path: '/client/incoming.mp3',
    paths: ['/client/incoming.mp3', '/sounds/incoming.mp3', '/audio/incoming.mp3', '/client/ringtone.mp3'],
    label: '着信音'
  },
  outgoing: {
    path: '/client/outgoing.mp3',
    paths: ['/client/outgoing.mp3', '/sounds/outgoing.mp3', '/audio/outgoing.mp3'],
    label: '発信音'
  },
  disconnect: {
    path: '/client/disconnect.mp3',
    paths: ['/client/disconnect.mp3', '/sounds/disconnect.mp3', '/audio/disconnect.mp3', '/client/hangup.mp3'],
    label: '切断音'
  },
  doorchime: {
    path: '/client/doorchime.mp3',
    paths: ['/client/doorchime.mp3', '/sounds/doorchime.mp3', '/audio/doorchime.mp3', '/client/chime.mp3', '/client/notification.mp3'],
    label: 'ドアチャイム'
  }
};

// プリセット音声の定義（sounds/フォルダ内の音源）
// 実際のファイル名と一致させる必要がある
const PRESET_SOUNDS = {
  calling: [
    { id: 'calling_1', file: '電話の呼び出し音.mp3', label: '電話の呼び出し音' },
    { id: 'calling_2', file: '電話をかける.mp3', label: '電話をかける' },
    { id: 'calling_morse', file: 'モールス信号.mp3', label: 'モールス信号' },
    { id: 'calling_countdown', file: 'カウントダウン.mp3', label: 'カウントダウン' },
    { id: 'calling_timpani', file: 'ティンパニロール.mp3', label: 'ティンパニロール' },
    { id: 'calling_piano', file: 'ピアノの単音.mp3', label: 'ピアノの単音' }
  ],
  incoming: [
    { id: 'incoming_phone', file: '電話の着信音.mp3', label: '電話の着信音' },
    { id: 'incoming_oldphone', file: '黒電話のベル.mp3', label: '黒電話のベル' },
    { id: 'incoming_mobile', file: '携帯電話の呼び出し音.mp3', label: '携帯電話の呼び出し音' },
    { id: 'incoming_denwa1', file: '電話です.mp3', label: '電話です' },
    { id: 'incoming_denwa2', file: '電話です2.mp3', label: '電話です2' },
    { id: 'incoming_chakushin', file: '着信です.mp3', label: '着信です' },
    { id: 'incoming_horn', file: 'ほら貝.mp3', label: 'ほら貝' },
    { id: 'incoming_cat1', file: '猫の鳴き声1.mp3', label: '猫の鳴き声1' },
    { id: 'incoming_cat2', file: '猫の鳴き声2.mp3', label: '猫の鳴き声2' },
    { id: 'incoming_cat3', file: '猫の鳴き声3.mp3', label: '猫の鳴き声3' },
    { id: 'incoming_chime', file: '学校のチャイム.mp3', label: '学校のチャイム' },
    { id: 'incoming_broadcast', file: '放送開始チャイム.mp3', label: '放送開始チャイム' },
    { id: 'incoming_bell', file: '鈴を鳴らす.mp3', label: '鈴を鳴らす' },
    { id: 'incoming_dragon', file: 'ドラゴンの鳴き声.mp3', label: 'ドラゴンの鳴き声' }
  ],
  outgoing: [
    { id: 'outgoing_go', file: 'さあいくぞ.mp3', label: 'さあいくぞ' },
    { id: 'outgoing_sword', file: '剣を抜く.mp3', label: '剣を抜く' },
    { id: 'outgoing_charge', file: '突撃ラッパ.mp3', label: '突撃ラッパ' },
    { id: 'outgoing_horn', file: 'ほら貝.mp3', label: 'ほら貝' },
    { id: 'outgoing_yoroshiku', file: 'よろしくお願いします.mp3', label: 'よろしくお願いします' },
    { id: 'outgoing_oteyawaraka', file: 'お手柔らかに.mp3', label: 'お手柔らかに' },
    { id: 'outgoing_jan', file: 'ジャン.mp3', label: 'ジャン' },
    { id: 'outgoing_taiko1', file: '和太鼓でドン.mp3', label: '和太鼓でドン' },
    { id: 'outgoing_taiko2', file: '和太鼓でドドン.mp3', label: '和太鼓でドドン' },
    { id: 'outgoing_dj1', file: 'DJスクラッチ1.mp3', label: 'DJスクラッチ1' },
    { id: 'outgoing_dj2', file: 'DJスクラッチ2.mp3', label: 'DJスクラッチ2' },
    { id: 'outgoing_mobile', file: '携帯電話に出る.mp3', label: '携帯電話に出る' }
  ],
  disconnect: [
    { id: 'disconnect_fanfare', file: 'ファンファーレ.mp3', label: 'ファンファーレ' },
    { id: 'disconnect_levelup', file: 'レベルアップ.mp3', label: 'レベルアップ' },
    { id: 'disconnect_applause', file: '大勢で拍手.mp3', label: '大勢で拍手' },
    { id: 'disconnect_cheer', file: '歓声と拍手.mp3', label: '歓声と拍手' },
    { id: 'disconnect_stadium', file: 'スタジアムの歓声.mp3', label: 'スタジアムの歓声' },
    { id: 'disconnect_quiz', file: 'クイズ正解.mp3', label: 'クイズ正解' },
    { id: 'disconnect_jajan', file: 'ジャジャーン.mp3', label: 'ジャジャーン' },
    { id: 'disconnect_chanchan1', file: 'ちゃんちゃん1.mp3', label: 'ちゃんちゃん1' },
    { id: 'disconnect_chanchan2', file: 'ちゃんちゃん2.mp3', label: 'ちゃんちゃん2' },
    { id: 'disconnect_chanchan3', file: 'ちゃんちゃん3.mp3', label: 'ちゃんちゃん3' },
    { id: 'disconnect_chin', file: 'チーン.mp3', label: 'チーン' },
    { id: 'disconnect_dondon', file: 'ドンドンパフパフ.mp3', label: 'ドンドンパフパフ' },
    { id: 'disconnect_broadcast', file: '放送終了チャイム.mp3', label: '放送終了チャイム' },
    { id: 'disconnect_hangup1', file: '電話が切れる1.mp3', label: '電話が切れる1' },
    { id: 'disconnect_hangup2', file: '電話が切れる2.mp3', label: '電話が切れる2' },
    { id: 'disconnect_nice', file: 'やるじゃないか.mp3', label: 'やるじゃないか' },
    { id: 'disconnect_yeah', file: 'イエーイ.mp3', label: 'イエーイ' }
  ],
  doorchime: [
    { id: 'doorchime_temple', file: 'お寺の鐘.mp3', label: 'お寺の鐘' },
    { id: 'doorchime_quiz', file: 'クイズ出題.mp3', label: 'クイズ出題' },
    { id: 'doorchime_horn', file: 'ほら貝.mp3', label: 'ほら貝' },
    { id: 'doorchime_pa', file: 'パッ.mp3', label: 'パッ' },
    { id: 'doorchime_puff', file: 'パフ.mp3', label: 'パフ' },
    { id: 'doorchime_peta', file: 'ペタッ.mp3', label: 'ペタッ' },
    { id: 'doorchime_message', file: 'メッセージが届きました.mp3', label: 'メッセージが届きました' },
    { id: 'doorchime_notify', file: 'メッセージが来てるよ.mp3', label: 'メッセージが来てるよ' },
    { id: 'doorchime_mail', file: 'メールだよ.mp3', label: 'メールだよ' },
    { id: 'doorchime_taiko', file: '和太鼓でカカッ.mp3', label: '和太鼓でカカッ' }
  ],
  countdown: [
    { id: 'countdown_button2', file: '決定ボタンを押す2.mp3', label: 'ボタンを押す音2' },
    { id: 'countdown_button9', file: '決定ボタンを押す9.mp3', label: 'ボタンを押す音9' },
    { id: 'countdown_cat1', file: '猫の鳴き声1.mp3', label: '猫の鳴き声1' },
    { id: 'countdown_cat2', file: '猫の鳴き声2.mp3', label: '猫の鳴き声2' },
    { id: 'countdown_cat3', file: '猫の鳴き声3.mp3', label: '猫の鳴き声3' },
    { id: 'countdown_none', file: null, label: 'なし（無音）' }
  ]
};

/**
 * IndexedDBを開く
 */
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
  });
}

/**
 * 音声データを保存
 */
async function saveSound(id, data, fileName, mimeType) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    const record = {
      id,
      data,
      fileName,
      mimeType,
      updatedAt: Date.now()
    };

    const request = store.put(record);
    request.onsuccess = () => resolve(true);
    request.onerror = () => reject(request.error);
  });
}

/**
 * 音声データを取得
 */
async function getSound(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);

    const request = store.get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

/**
 * 音声データを削除
 */
async function deleteSound(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    const request = store.delete(id);
    request.onsuccess = () => resolve(true);
    request.onerror = () => reject(request.error);
  });
}

/**
 * すべての音声設定を取得
 */
async function getAllSounds() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);

    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

/**
 * 設定を取得（有効/無効状態）
 */
async function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['settings'], (result) => {
      resolve(result.settings || {
        enabled: true,
        sounds: {}
      });
    });
  });
}

/**
 * 設定を保存
 */
async function saveSettings(settings) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ settings }, resolve);
  });
}

/**
 * メッセージハンドラー
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message)
    .then(sendResponse)
    .catch((error) => sendResponse({ success: false, error: error.message }));
  return true; // 非同期レスポンス
});

async function handleMessage(message) {
  switch (message.type) {
    case 'GET_SOUND_TYPES':
      return { success: true, data: SOUND_TYPES };

    case 'GET_PRESET_SOUNDS':
      return { success: true, data: PRESET_SOUNDS };

    case 'GET_SOUND':
      const sound = await getSound(message.id);
      return { success: true, data: sound };

    case 'SAVE_SOUND':
      if (message.data && message.data.length > MAX_FILE_SIZE) {
        return { success: false, error: 'ファイルサイズが300MBを超えています' };
      }
      await saveSound(message.id, message.data, message.fileName, message.mimeType);
      await updateSoundSetting(message.id, 'custom');
      return { success: true };

    case 'DELETE_SOUND':
      await deleteSound(message.id);
      await updateSoundSetting(message.id, 'original');
      return { success: true };

    case 'SET_PRESET':
      await updateSoundSetting(message.id, 'preset', message.presetId);
      return { success: true };

    case 'SET_ORIGINAL':
      await deleteSound(message.id);
      await updateSoundSetting(message.id, 'original');
      return { success: true };

    case 'GET_ALL_SOUNDS':
      const sounds = await getAllSounds();
      return { success: true, data: sounds };

    case 'GET_SETTINGS':
      const settings = await getSettings();
      return { success: true, data: settings };

    case 'SAVE_SETTINGS':
      await saveSettings(message.settings);
      return { success: true };

    case 'GET_SOUND_CONFIG':
      // Content Script用: 現在の音声設定を取得
      const config = await getSoundConfig();
      return { success: true, data: config };

    case 'PLAY_HAND_SIGN_SOUND':
      // ハンドサイン通知音を再生
      await playHandSignSound(message.preset);
      return { success: true };

    case 'GET_HAND_SIGN_SETTINGS':
      const handSignSettings = await getHandSignSettings();
      return { success: true, data: handSignSettings };

    case 'SAVE_HAND_SIGN_SETTINGS':
      await saveHandSignSettings(message.settings);
      return { success: true };

    case 'SAVE_NOTIFICATION_CUSTOM_SOUND':
      // カスタム通知音を保存
      await chrome.storage.local.set({
        notificationCustomSound: {
          data: message.data,
          fileName: message.fileName,
          mimeType: message.mimeType
        }
      });
      return { success: true };

    case 'DELETE_NOTIFICATION_CUSTOM_SOUND':
      // カスタム通知音を削除
      await chrome.storage.local.remove('notificationCustomSound');
      return { success: true };

    case 'INIT_HAND_DETECTOR':
      // オフスクリーンでハンド検出器を初期化
      const initResult = await sendToOffscreen({ type: 'INIT_DETECTOR' });
      return initResult;

    case 'DETECT_HAND_SIGN':
      // オフスクリーンでハンドサイン検出
      const detectResult = await sendToOffscreen({
        type: 'DETECT_HAND_SIGN',
        imageData: message.imageData
      });
      return detectResult;

    case 'GET_DETECTOR_STATUS':
      // オフスクリーンの検出器状態を取得
      const statusResult = await sendToOffscreen({ type: 'GET_STATUS' });
      return statusResult;

    // 文字起こし関連
    case 'START_TRANSCRIPTION':
      const startResult = await sendToOffscreen({ type: 'START_TRANSCRIPTION' });
      return startResult;

    case 'STOP_TRANSCRIPTION':
      const stopResult = await sendToOffscreen({ type: 'STOP_TRANSCRIPTION' });
      return stopResult;

    case 'GET_TRANSCRIPT':
      const transcriptResult = await sendToOffscreen({ type: 'GET_TRANSCRIPT' });
      return transcriptResult;

    // LLM設定
    case 'GET_LLM_SETTINGS':
      const llmSettings = await getLLMSettings();
      return { success: true, data: llmSettings };

    case 'SAVE_LLM_SETTINGS':
      await saveLLMSettings(message.settings);
      return { success: true };

    case 'TEST_LLM_CONNECTION':
      const testResult = await testLLMConnection(message.settings);
      return testResult;

    case 'STRUCTURE_TRANSCRIPT':
      const structureResult = await structureTranscript(message.transcript, message.settings);
      return structureResult;

    default:
      return { success: false, error: 'Unknown message type' };
  }
}

/**
 * 音声設定を更新
 */
async function updateSoundSetting(id, mode, presetId = null) {
  const settings = await getSettings();
  if (!settings.sounds) {
    settings.sounds = {};
  }
  settings.sounds[id] = { mode };
  if (presetId) {
    settings.sounds[id].presetId = presetId;
  }
  await saveSettings(settings);
}

/**
 * Content Script用の音声設定を生成
 */
async function getSoundConfig() {
  const settings = await getSettings();
  const sounds = await getAllSounds();

  const config = {
    enabled: settings.enabled !== false,
    sounds: {}
  };

  for (const [id, typeInfo] of Object.entries(SOUND_TYPES)) {
    const soundSetting = settings.sounds?.[id] || { mode: 'original' };
    const soundData = sounds.find(s => s.id === id);

    config.sounds[id] = {
      path: typeInfo.path,
      paths: typeInfo.paths || [typeInfo.path],
      mode: soundSetting.mode,
      customData: soundSetting.mode === 'custom' && soundData ? soundData.data : null,
      presetId: soundSetting.presetId || null,
      // プリセットの場合はファイルパスを追加
      presetFile: null
    };

    // プリセット音声の場合、ファイル名を取得
    if (soundSetting.mode === 'preset' && soundSetting.presetId) {
      const presets = PRESET_SOUNDS[id] || [];
      const preset = presets.find(p => p.id === soundSetting.presetId);
      if (preset) {
        config.sounds[id].presetFile = preset.file;
      }
    }
  }

  return config;
}

/**
 * ハンドサイン設定を取得
 */
async function getHandSignSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['handSignSettings'], (result) => {
      resolve(result.handSignSettings || {
        enabled: true,
        myName: '',
        detectAll: true,
        targetMembers: [],
        notifications: {
          toast: true,
          sound: true,
          soundPreset: 'doorchime'
        }
      });
    });
  });
}

/**
 * ハンドサイン設定を保存
 */
async function saveHandSignSettings(settings) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ handSignSettings: settings }, resolve);
  });
}

/**
 * ハンドサイン通知音を再生
 */
async function playHandSignSound(presetType) {
  try {
    const handSignSettings = await getHandSignSettings();
    const soundValue = handSignSettings.notifications?.soundPreset || presetType || 'outgoing:outgoing_horn';

    let soundUrl = null;

    if (soundValue === 'custom') {
      // カスタム音声（storage.localから取得）
      const result = await chrome.storage.local.get('notificationCustomSound');
      if (result.notificationCustomSound?.data) {
        soundUrl = result.notificationCustomSound.data; // Base64データをそのまま送る
      }
    } else if (soundValue.includes(':')) {
      // 新形式: category:presetId
      const [category, presetId] = soundValue.split(':');
      const presets = PRESET_SOUNDS[category];
      if (presets) {
        const preset = presets.find(p => p.id === presetId);
        if (preset) {
          soundUrl = chrome.runtime.getURL(`sounds/${category}/${preset.file}`);
        }
      }
    } else {
      // 旧形式: カテゴリ名のみ（後方互換性）
      const presets = PRESET_SOUNDS[soundValue];
      if (presets && presets.length > 0) {
        const preset = presets[Math.floor(Math.random() * presets.length)];
        soundUrl = chrome.runtime.getURL(`sounds/${soundValue}/${preset.file}`);
      }
    }

    if (!soundUrl) return;

    // アクティブなタブで音声を再生
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs.length > 0) {
      chrome.tabs.sendMessage(tabs[0].id, {
        type: 'PLAY_NOTIFICATION_SOUND',
        url: soundUrl
      });
    }
  } catch (error) {
    console.error('Failed to play hand sign sound:', error);
  }
}

// オフスクリーンドキュメント管理
let creatingOffscreen = null;

/**
 * オフスクリーンドキュメントを作成
 */
async function setupOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL('offscreen.html');

  // 既存のオフスクリーンドキュメントを確認
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [offscreenUrl]
  });

  if (existingContexts.length > 0) {
    return; // 既に存在する
  }

  // 作成中の場合は待機
  if (creatingOffscreen) {
    await creatingOffscreen;
    return;
  }

  // 新規作成
  creatingOffscreen = chrome.offscreen.createDocument({
    url: offscreenUrl,
    reasons: ['WORKERS'],
    justification: 'Hand pose detection using MediaPipe requires WebAssembly and worker support'
  });

  await creatingOffscreen;
  creatingOffscreen = null;
  console.log('[Background] Offscreen document created');
}

/**
 * オフスクリーンドキュメントにメッセージを送信
 */
async function sendToOffscreen(message) {
  try {
    await setupOffscreenDocument();
    return await chrome.runtime.sendMessage({
      ...message,
      target: 'offscreen'
    });
  } catch (error) {
    console.error('[Background] Failed to send message to offscreen:', error);
    // オフスクリーンドキュメントが閉じられていた場合は再作成を試みる
    creatingOffscreen = null;
    try {
      await setupOffscreenDocument();
      return await chrome.runtime.sendMessage({
        ...message,
        target: 'offscreen'
      });
    } catch (retryError) {
      console.error('[Background] Retry failed:', retryError);
      return { success: false, error: 'Offscreen communication failed' };
    }
  }
}

// 拡張機能インストール時
chrome.runtime.onInstalled.addListener(() => {
  console.log('Remowork Sound Changer installed');
});

// ========================================
// LLM設定と構造化機能
// ========================================

/**
 * LLM設定を取得
 */
async function getLLMSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['llmSettings'], (result) => {
      resolve(result.llmSettings || {
        enabled: false,
        provider: 'gemini',
        model: 'gemini-2.0-flash',
        apiKey: '',
        customEndpoint: '',
        autoStructure: true,
        extractActions: true,
        extractDecisions: true
      });
    });
  });
}

/**
 * LLM設定を保存
 */
async function saveLLMSettings(settings) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ llmSettings: settings }, resolve);
  });
}

/**
 * LLM接続テスト
 */
async function testLLMConnection(settings) {
  const testPrompt = 'Say "Hello!" in one word.';

  try {
    const response = await callLLM(testPrompt, settings);
    return { success: true, message: response.substring(0, 50) };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * LLM APIを呼び出す
 */
async function callLLM(prompt, settings) {
  const { provider, model, apiKey, customEndpoint } = settings;

  switch (provider) {
    case 'gemini':
      return await callGeminiAPI(prompt, model, apiKey);
    case 'openai':
      return await callOpenAIAPI(prompt, model, apiKey);
    case 'claude':
      return await callClaudeAPI(prompt, model, apiKey);
    case 'custom':
      return await callCustomAPI(prompt, model, apiKey, customEndpoint);
    default:
      throw new Error('Unknown provider: ' + provider);
  }
}

/**
 * Gemini APIを呼び出す
 */
async function callGeminiAPI(prompt, model, apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      contents: [{
        parts: [{ text: prompt }]
      }]
    })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || `API error: ${response.status}`);
  }

  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

/**
 * OpenAI APIを呼び出す
 */
async function callOpenAIAPI(prompt, model, apiKey) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 2000
    })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || `API error: ${response.status}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}

/**
 * Claude APIを呼び出す
 */
async function callClaudeAPI(prompt, model, apiKey) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: model,
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || `API error: ${response.status}`);
  }

  const data = await response.json();
  return data.content?.[0]?.text || '';
}

/**
 * カスタムAPI（OpenAI互換）を呼び出す
 */
async function callCustomAPI(prompt, model, apiKey, endpoint) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: model || 'default',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 2000
    })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || `API error: ${response.status}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}

/**
 * 文字起こしを構造化
 */
async function structureTranscript(transcript, settings) {
  if (!transcript || transcript.trim().length === 0) {
    return { success: false, error: 'No transcript provided' };
  }

  const prompt = buildStructurePrompt(transcript, settings);

  try {
    const result = await callLLM(prompt, settings);
    return { success: true, structured: result };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * 構造化用プロンプトを生成
 */
function buildStructurePrompt(input, settings) {
  // プロフィール情報を構築
  let profileContext = '';
  const profile = settings.profile || {};
  if (profile.name || profile.company || profile.role || profile.context) {
    profileContext = `

【参加者情報（漢字変換の参考にしてください）】
`;
    if (profile.name) {
      profileContext += `- 記録者の名前: ${profile.name}\n`;
    }
    if (profile.company) {
      profileContext += `- 会社名: ${profile.company}\n`;
    }
    if (profile.role) {
      profileContext += `- 役職: ${profile.role}\n`;
    }
    if (profile.context) {
      profileContext += `- その他の情報: ${profile.context}\n`;
    }
  }

  let prompt = `以下は会議の記録です。文字起こしと手動メモの両方を参照して、内容を構造化してください。
${profileContext}
${input}

以下の形式で構造化してください（├─ や └─ でツリー構造を表現）:

会議メモ
├─ 議題1: ○○について
│  ├─ 発言者: 内容
│  ├─ 発言者: 内容
`;

  if (settings.extractDecisions) {
    prompt += `│  └─ 【決定】決定事項の内容
`;
  }

  prompt += `├─ 議題2: △△について
│  ├─ 発言者: 内容
`;

  if (settings.extractActions) {
    prompt += `└─ 【アクション】
   ├─ 担当者: タスク内容（期限があれば）
   └─ 担当者: タスク内容
`;
  }

  prompt += `
ルール:
- 文字起こしと手動メモの両方から情報を抽出
- 発言者が特定できない場合は省略可
- 議題・トピックごとにグループ化
- 決定事項は【決定】、アクションアイテムは【アクション】でマーク
- 簡潔に、重要なポイントのみ抽出
- 参加者情報を参考に、固有名詞や専門用語の漢字変換を正確に`;

  return prompt;
}

/**
 * Remowork Sound Changer - Popup Script
 * 設定UIのロジック
 */

const MAX_FILE_SIZE = 300 * 1024 * 1024; // 300MB
const MAX_DURATION_SECONDS = 10 * 60; // 10分

const SOUND_LABELS = {
  calling: '発信中（呼び出し音）',
  incoming: '着信音',
  outgoing: '発信音',
  disconnect: '切断音',
  doorchime: 'ドアチャイム'
};

const SOUND_DESCRIPTIONS = {
  calling: '相手を呼び出し中に鳴る音',
  incoming: '電話がかかってきた時に鳴る音',
  outgoing: '発信ボタンを押した時に鳴る音',
  disconnect: '通話が終了・切断された時に鳴る音',
  doorchime: '内線着信時に鳴る音'
};

const MODE_LABELS = {
  original: 'オリジナル',
  custom: 'カスタム'
};

// Chrome拡張機能として動作しているかチェック
const isExtension = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage;

// デモ用のデフォルトデータ
const DEFAULT_SOUND_TYPES = {
  calling: { path: '/client/calling.mp3', label: '発信中（呼び出し音）' },
  incoming: { path: '/client/incoming.mp3', label: '着信音' },
  outgoing: { path: '/client/outgoing.mp3', label: '発信音' },
  disconnect: { path: '/client/disconnect.mp3', label: '切断音' },
  doorchime: { path: '/client/doorchime.mp3', label: 'ドアチャイム' }
};

let soundTypes = {};
let presetSounds = {};
let settings = { enabled: true, sounds: {} };
let savedSounds = [];
let previewAudio = null;
let currentPlayingId = null;

// ハンドサイン設定
let handSignSettings = {
  enabled: true,
  myName: '',
  detectAll: true,
  targetMembers: [],
  notifications: {
    toast: true,
    sound: true,
    soundPreset: 'doorchime'
  }
};

/**
 * 初期化
 */
document.addEventListener('DOMContentLoaded', async () => {
  previewAudio = document.getElementById('preview-audio');

  if (isExtension) {
    try {
      // 音声タイプを取得
      const typesResponse = await sendMessage({ type: 'GET_SOUND_TYPES' });
      console.log('[Popup] typesResponse:', typesResponse);
      if (typesResponse && typesResponse.success && typesResponse.data) {
        soundTypes = typesResponse.data;
      } else {
        // フォールバック: デフォルト値を使用
        soundTypes = DEFAULT_SOUND_TYPES;
      }

      // 設定を取得
      const settingsResponse = await sendMessage({ type: 'GET_SETTINGS' });
      console.log('[Popup] settingsResponse:', settingsResponse);
      if (settingsResponse && settingsResponse.success && settingsResponse.data) {
        settings = settingsResponse.data;
      }

      // 保存済み音声を取得
      const soundsResponse = await sendMessage({ type: 'GET_ALL_SOUNDS' });
      console.log('[Popup] soundsResponse:', soundsResponse);
      if (soundsResponse && soundsResponse.success && soundsResponse.data) {
        savedSounds = soundsResponse.data;
      }

      // プリセット音声を取得
      const presetsResponse = await sendMessage({ type: 'GET_PRESET_SOUNDS' });
      console.log('[Popup] presetsResponse:', presetsResponse);
      if (presetsResponse && presetsResponse.success && presetsResponse.data) {
        presetSounds = presetsResponse.data;
      }
    } catch (error) {
      console.error('[Popup] Error loading data:', error);
      // エラー時はデフォルト値を使用
      soundTypes = DEFAULT_SOUND_TYPES;
    }
  } else {
    // デモモード（ブラウザで直接開いた場合）
    soundTypes = DEFAULT_SOUND_TYPES;
    console.log('[Demo Mode] Chrome拡張機能としてインストールしてください');
  }

  console.log('[Popup] soundTypes:', soundTypes);
  console.log('[Popup] settings:', settings);

  // ハンドサイン設定を読み込む
  if (isExtension) {
    try {
      const handSignResponse = await sendMessage({ type: 'GET_HAND_SIGN_SETTINGS' });
      console.log('[Popup] handSignResponse:', handSignResponse);
      if (handSignResponse && handSignResponse.success && handSignResponse.data) {
        handSignSettings = { ...handSignSettings, ...handSignResponse.data };
      }
    } catch (error) {
      console.error('[Popup] Error loading hand sign settings:', error);
    }
  }

  // UIを構築
  renderSoundList();
  setupEventListeners();
  setupTabNavigation();
  setupHandSignSettings();

  // 有効/無効トグルの初期状態
  document.getElementById('enabled-toggle').checked = settings.enabled !== false;
});

/**
 * 音声リストをレンダリング
 */
function renderSoundList() {
  const container = document.getElementById('sound-list');
  const template = document.getElementById('sound-item-template');

  container.innerHTML = '';

  for (const [id, typeInfo] of Object.entries(soundTypes)) {
    const clone = template.content.cloneNode(true);
    const item = clone.querySelector('.sound-item');

    item.dataset.id = id;
    item.querySelector('.sound-label').textContent = SOUND_LABELS[id] || typeInfo.label;
    item.querySelector('.sound-description').textContent = SOUND_DESCRIPTIONS[id] || '';

    // モード選択にプリセット音声を追加
    const modeSelect = item.querySelector('.sound-mode');

    // プリセット音声をドロップダウンに追加
    const presets = presetSounds[id] || [];
    if (presets.length > 0) {
      // プリセットグループを追加（customの前に挿入）
      const customOption = modeSelect.querySelector('option[value="custom"]');

      // セパレーター
      const separator = document.createElement('option');
      separator.disabled = true;
      separator.textContent = '── プリセット ──';
      modeSelect.insertBefore(separator, customOption);

      // 各プリセット音声
      for (const preset of presets) {
        const option = document.createElement('option');
        option.value = `preset:${preset.id}`;
        option.textContent = preset.label;
        modeSelect.insertBefore(option, customOption);
      }

      // カスタムの前にセパレーター
      const separator2 = document.createElement('option');
      separator2.disabled = true;
      separator2.textContent = '── カスタム ──';
      modeSelect.insertBefore(separator2, customOption);
    }

    // 現在の設定値を反映
    const currentMode = settings.sounds?.[id]?.mode || 'original';
    const currentPreset = settings.sounds?.[id]?.presetId || null;

    if (currentMode === 'preset' && currentPreset) {
      modeSelect.value = `preset:${currentPreset}`;
    } else {
      modeSelect.value = currentMode;
    }

    // ステータス表示
    updateStatusBadge(item, currentMode, currentPreset);

    // ファイル情報（カスタムモードの場合、または保存済み音声がある場合）
    const savedSound = savedSounds.find(s => s.id === id);
    const fileInfo = item.querySelector('.sound-file-info');
    if (savedSound) {
      if (currentMode === 'custom') {
        fileInfo.textContent = savedSound.fileName || 'カスタム音声';
      } else {
        // オリジナルモードでもカスタム音声があることを表示
        fileInfo.textContent = `(保存済み: ${savedSound.fileName || 'カスタム音声'})`;
        fileInfo.style.opacity = '0.6';
      }
    }

    container.appendChild(clone);
  }
}

/**
 * ステータスバッジを更新
 */
function updateStatusBadge(item, mode, presetId = null) {
  const badge = item.querySelector('.sound-status');

  if (mode === 'preset' && presetId) {
    // プリセットの場合はプリセット名を表示
    const soundId = item.dataset.id;
    const preset = (presetSounds[soundId] || []).find(p => p.id === presetId);
    badge.textContent = preset ? preset.label : 'プリセット';
    badge.className = 'sound-status preset';
  } else {
    badge.textContent = MODE_LABELS[mode] || mode;
    badge.className = `sound-status ${mode}`;
  }
}

/**
 * イベントリスナーを設定
 */
function setupEventListeners() {
  // 有効/無効トグル
  document.getElementById('enabled-toggle').addEventListener('change', async (e) => {
    settings.enabled = e.target.checked;
    if (isExtension) {
      await sendMessage({ type: 'SAVE_SETTINGS', settings });
    }
    showToast(settings.enabled ? '有効化しました' : '無効化しました');
  });

  // 音声リスト内のイベント（イベント委譲）
  document.getElementById('sound-list').addEventListener('change', handleSoundListChange);
  document.getElementById('sound-list').addEventListener('click', handleSoundListClick);
}

/**
 * 音声リストの変更イベント
 */
async function handleSoundListChange(e) {
  const target = e.target;
  const item = target.closest('.sound-item');
  if (!item) return;

  const soundId = item.dataset.id;

  // モード変更
  if (target.classList.contains('sound-mode')) {
    const mode = target.value;
    await handleModeChange(soundId, mode, item);
  }

  // ファイルアップロード
  if (target.type === 'file' && target.files.length > 0) {
    await handleFileUpload(soundId, target.files[0], item);
    target.value = ''; // リセット
  }
}

/**
 * モード変更の処理
 */
async function handleModeChange(soundId, mode, item) {
  // 該当の音声が再生中なら停止
  if (currentPlayingId === soundId) {
    stopPlayback();
  }

  item.classList.add('loading');

  try {
    // preset:xxx 形式かチェック
    if (mode.startsWith('preset:')) {
      const presetId = mode.replace('preset:', '');
      if (isExtension) {
        await sendMessage({ type: 'SET_PRESET', id: soundId, presetId });
      }
      item.querySelector('.sound-file-info').textContent = '';
      updateStatusBadge(item, 'preset', presetId);

      const preset = (presetSounds[soundId] || []).find(p => p.id === presetId);
      showToast(`${preset?.label || 'プリセット'}に変更しました`, 'success');
    } else if (mode === 'original') {
      if (isExtension) {
        await sendMessage({ type: 'SET_ORIGINAL', id: soundId });
      }
      item.querySelector('.sound-file-info').textContent = '';
      updateStatusBadge(item, mode);
      showToast('オリジナル音声に戻しました', 'success');
    } else if (mode === 'custom') {
      // カスタムの場合は既存のカスタム音声があるか確認
      let hasCustomSound = false;

      if (isExtension) {
        const soundResponse = await sendMessage({ type: 'GET_SOUND', id: soundId });
        hasCustomSound = soundResponse && soundResponse.data;
        if (hasCustomSound) {
          item.querySelector('.sound-file-info').textContent = soundResponse.data.fileName || 'カスタム音声';
        }
      }

      if (!hasCustomSound) {
        // カスタム音声がない場合はファイル選択を促す
        showToast('音声ファイルをアップロードしてください', 'info');
        item.querySelector('input[type="file"]').click();
        // モードを元に戻す
        item.querySelector('.sound-mode').value = 'original';
        return;
      }

      updateStatusBadge(item, mode);
      showToast('カスタム音声に変更しました', 'success');
    }
  } catch (error) {
    showToast('エラーが発生しました: ' + error.message, 'error');
  } finally {
    item.classList.remove('loading');
  }
}

/**
 * ファイルアップロードの処理
 */
async function handleFileUpload(soundId, file, item) {
  // サイズチェック
  if (file.size > MAX_FILE_SIZE) {
    showToast('ファイルサイズが300MBを超えています', 'error');
    return;
  }

  // 音声ファイルかチェック
  if (!file.type.startsWith('audio/')) {
    showToast('音声ファイルを選択してください', 'error');
    return;
  }

  // 音声の長さをチェック
  try {
    const duration = await getAudioDuration(file);
    if (duration > MAX_DURATION_SECONDS) {
      showToast('音声の長さは10分以内にしてください', 'error');
      return;
    }
  } catch (e) {
    console.warn('Duration check failed:', e);
  }

  item.classList.add('loading');

  try {
    // Base64に変換
    const data = await fileToBase64(file);

    if (isExtension) {
      // 保存
      const response = await sendMessage({
        type: 'SAVE_SOUND',
        id: soundId,
        data: data,
        fileName: file.name,
        mimeType: file.type
      });

      if (!response || !response.success) {
        throw new Error(response?.error || '保存に失敗しました');
      }
    }

    // UI更新
    item.querySelector('.sound-mode').value = 'custom';
    updateStatusBadge(item, 'custom');
    item.querySelector('.sound-file-info').textContent = file.name;

    showToast('音声を保存しました', 'success');
  } catch (error) {
    showToast('アップロードに失敗しました: ' + error.message, 'error');
  } finally {
    item.classList.remove('loading');
  }
}

/**
 * 音声リストのクリックイベント
 */
async function handleSoundListClick(e) {
  const target = e.target.closest('button');
  if (!target) return;

  const item = target.closest('.sound-item');
  if (!item) return;

  const soundId = item.dataset.id;

  // 再生ボタン
  if (target.classList.contains('btn-play')) {
    await handlePlayClick(soundId, target, item);
  }
}

/**
 * 再生を停止する共通関数
 */
function stopPlayback() {
  if (!previewAudio) return;

  previewAudio.pause();
  previewAudio.currentTime = 0;

  if (currentPlayingId) {
    const prevButton = document.querySelector(`.sound-item[data-id="${currentPlayingId}"] .btn-play`);
    if (prevButton) {
      updatePlayButtonState(prevButton, false);
    }
    currentPlayingId = null;
  }
}

/**
 * 再生ボタンの状態を更新
 */
function updatePlayButtonState(button, isPlaying) {
  const iconPlay = button.querySelector('.icon-play');
  const iconStop = button.querySelector('.icon-stop');

  if (isPlaying) {
    button.classList.add('playing');
    button.title = '停止';
    if (iconPlay) iconPlay.style.display = 'none';
    if (iconStop) iconStop.style.display = 'block';
  } else {
    button.classList.remove('playing');
    button.title = '再生';
    if (iconPlay) iconPlay.style.display = 'block';
    if (iconStop) iconStop.style.display = 'none';
  }
}

/**
 * 再生ボタンのクリック処理
 */
async function handlePlayClick(soundId, button, item) {
  // 再生中なら停止
  if (currentPlayingId === soundId) {
    stopPlayback();
    return;
  }

  // 他の再生を停止
  stopPlayback();

  const modeValue = item.querySelector('.sound-mode').value;
  let audioUrl = null;

  try {
    if (modeValue === 'original') {
      showToast('オリジナル音声のプレビューは対象サイトでのみ可能です');
      return;
    }

    // プリセット音声
    if (modeValue.startsWith('preset:')) {
      const presetId = modeValue.replace('preset:', '');
      const presets = presetSounds[soundId] || [];
      const preset = presets.find(p => p.id === presetId);

      if (preset) {
        // 拡張機能内のプリセット音声を再生
        audioUrl = chrome.runtime.getURL(`sounds/${soundId}/${preset.file}`);
      } else {
        showToast('プリセット音声が見つかりません');
        return;
      }
    }

    // カスタム音声
    if (modeValue === 'custom') {
      if (isExtension) {
        const soundResponse = await sendMessage({ type: 'GET_SOUND', id: soundId });
        if (soundResponse && soundResponse.data && soundResponse.data.data) {
          audioUrl = soundResponse.data.data;
        } else {
          showToast('カスタム音声が設定されていません');
          return;
        }
      } else {
        showToast('デモモードでは再生できません');
        return;
      }
    }

    if (audioUrl) {
      previewAudio.src = audioUrl;
      previewAudio.play();
      updatePlayButtonState(button, true);
      currentPlayingId = soundId;

      previewAudio.onended = () => {
        updatePlayButtonState(button, false);
        currentPlayingId = null;
      };

      previewAudio.onerror = () => {
        updatePlayButtonState(button, false);
        currentPlayingId = null;
        showToast('再生に失敗しました', 'error');
      };
    }
  } catch (error) {
    showToast('再生に失敗しました', 'error');
  }
}

/**
 * ファイルをBase64に変換
 */
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/**
 * 音声ファイルの長さを取得（秒）
 */
function getAudioDuration(file) {
  return new Promise((resolve, reject) => {
    const audio = new Audio();
    audio.onloadedmetadata = () => {
      resolve(audio.duration);
      URL.revokeObjectURL(audio.src);
    };
    audio.onerror = () => {
      reject(new Error('Failed to load audio'));
      URL.revokeObjectURL(audio.src);
    };
    audio.src = URL.createObjectURL(file);
  });
}

/**
 * Background Scriptにメッセージを送信
 */
function sendMessage(message) {
  return new Promise((resolve) => {
    if (!isExtension) {
      resolve({ success: false, error: 'Not running as extension' });
      return;
    }
    try {
      chrome.runtime.sendMessage(message, (response) => {
        // chrome.runtime.lastError をチェック
        if (chrome.runtime.lastError) {
          console.error('[Popup] sendMessage error:', chrome.runtime.lastError.message);
          resolve({ success: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve(response);
      });
    } catch (error) {
      console.error('[Popup] sendMessage exception:', error);
      resolve({ success: false, error: error.message });
    }
  });
}

/**
 * トースト通知を表示
 */
function showToast(message, type = 'info') {
  // 既存のトーストを削除
  const existingToast = document.querySelector('.toast');
  if (existingToast) {
    existingToast.remove();
  }

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 3000);
}

/**
 * タブナビゲーションを設定
 */
function setupTabNavigation() {
  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');

  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.dataset.tab;

      // ボタンのアクティブ状態を更新
      tabButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // コンテンツの表示を切り替え
      tabContents.forEach(content => {
        if (content.id === `tab-${tabId}`) {
          content.classList.add('active');
        } else {
          content.classList.remove('active');
        }
      });
    });
  });
}

/**
 * ハンドサイン設定を初期化
 */
function setupHandSignSettings() {
  // 有効/無効トグル
  const enabledToggle = document.getElementById('handsign-enabled-toggle');
  if (enabledToggle) {
    enabledToggle.checked = handSignSettings.enabled !== false;
    enabledToggle.addEventListener('change', async (e) => {
      handSignSettings.enabled = e.target.checked;
      await saveHandSignSettings();
      showToast(handSignSettings.enabled ? 'ハンドサイン検出を有効化しました' : 'ハンドサイン検出を無効化しました');
    });
  }

  // 自分の名前
  const myNameInput = document.getElementById('handsign-myname');
  if (myNameInput) {
    myNameInput.value = handSignSettings.myName || '';
    myNameInput.addEventListener('blur', async () => {
      handSignSettings.myName = myNameInput.value.trim();
      await saveHandSignSettings();
    });
  }

  // 検出対象（全員/選択）
  const detectTargetRadios = document.querySelectorAll('input[name="detect-target"]');
  detectTargetRadios.forEach(radio => {
    if (radio.value === 'all') {
      radio.checked = handSignSettings.detectAll !== false;
    } else {
      radio.checked = handSignSettings.detectAll === false;
    }

    radio.addEventListener('change', async () => {
      handSignSettings.detectAll = document.querySelector('input[name="detect-target"]:checked').value === 'all';
      const memberList = document.getElementById('member-list');
      if (memberList) {
        memberList.style.display = handSignSettings.detectAll ? 'none' : 'block';
      }
      await saveHandSignSettings();
    });
  });

  // メンバーリストの表示/非表示
  const memberList = document.getElementById('member-list');
  if (memberList) {
    memberList.style.display = handSignSettings.detectAll ? 'none' : 'block';
  }

  // トースト通知
  const toastCheckbox = document.getElementById('handsign-toast');
  if (toastCheckbox) {
    toastCheckbox.checked = handSignSettings.notifications?.toast !== false;
    toastCheckbox.addEventListener('change', async () => {
      handSignSettings.notifications = handSignSettings.notifications || {};
      handSignSettings.notifications.toast = toastCheckbox.checked;
      await saveHandSignSettings();
    });
  }

  // 通知音
  const soundCheckbox = document.getElementById('handsign-sound');
  if (soundCheckbox) {
    soundCheckbox.checked = handSignSettings.notifications?.sound !== false;
    soundCheckbox.addEventListener('change', async () => {
      handSignSettings.notifications = handSignSettings.notifications || {};
      handSignSettings.notifications.sound = soundCheckbox.checked;
      await saveHandSignSettings();
    });
  }

  // 通知音プリセット
  const soundPresetSelect = document.getElementById('handsign-sound-preset');
  if (soundPresetSelect) {
    soundPresetSelect.value = handSignSettings.notifications?.soundPreset || 'doorchime';
    soundPresetSelect.addEventListener('change', async () => {
      handSignSettings.notifications = handSignSettings.notifications || {};
      handSignSettings.notifications.soundPreset = soundPresetSelect.value;
      await saveHandSignSettings();
    });
  }

  // テスト再生ボタン
  const testSoundBtn = document.getElementById('test-handsign-sound');
  if (testSoundBtn) {
    testSoundBtn.addEventListener('click', async () => {
      const preset = handSignSettings.notifications?.soundPreset || 'doorchime';

      if (isExtension) {
        await sendMessage({ type: 'PLAY_HAND_SIGN_SOUND', preset });
        showToast('テスト再生中', 'info');
      } else {
        showToast('デモモードでは再生できません');
      }
    });
  }
}

/**
 * ハンドサイン設定を保存
 */
async function saveHandSignSettings() {
  if (isExtension) {
    try {
      await sendMessage({ type: 'SAVE_HAND_SIGN_SETTINGS', settings: handSignSettings });
      console.log('[Popup] Hand sign settings saved:', handSignSettings);
    } catch (error) {
      console.error('[Popup] Error saving hand sign settings:', error);
    }
  }
}

/**
 * Yandex Music Downloader — Popup Controller
 * Manages live player telemetry, user settings persistence, and direct 1-click downloads.
 */

document.addEventListener('DOMContentLoaded', async () => {
  // Elements
  const statusLabel = document.getElementById('statusLabel');
  const headerStatus = document.getElementById('headerStatus');
  const trackCover = document.getElementById('trackCover');
  const trackTitle = document.getElementById('trackTitle');
  const trackArtist = document.getElementById('trackArtist');
  const trackAlbum = document.getElementById('trackAlbum');
  const downloadCurrentBtn = document.getElementById('downloadCurrentBtn');
  const downloadBtnText = document.getElementById('downloadBtnText');
  const batchDownloadBtn = document.getElementById('batchDownloadBtn');

  // Settings elements
  const settingEmbedTags = document.getElementById('settingEmbedTags');
  const settingToasts = document.getElementById('settingToasts');
  const settingFilenamePattern = document.getElementById('settingFilenamePattern');
  const settingSaveAs = document.getElementById('settingSaveAs');

  let currentTrackData = null;

  // 1. Load persisted settings
  const defaultSettings = {
    embedTags: true,
    toasts: true,
    filenamePattern: 'artist-title',
    saveAs: false
  };

  const getSettings = async () => {
    return new Promise((resolve) => {
      if (chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(defaultSettings, resolve);
      } else {
        const saved = localStorage.getItem('ym_ext_settings');
        resolve(saved ? JSON.parse(saved) : defaultSettings);
      }
    });
  };

  const saveSettings = async (newSettings) => {
    if (chrome.storage && chrome.storage.local) {
      await chrome.storage.local.set(newSettings);
    } else {
      localStorage.setItem('ym_ext_settings', JSON.stringify(newSettings));
    }
  };

  const currentSettings = await getSettings();
  settingEmbedTags.checked = currentSettings.embedTags;
  settingToasts.checked = currentSettings.toasts;
  settingFilenamePattern.value = currentSettings.filenamePattern;
  settingSaveAs.checked = currentSettings.saveAs;

  // Listen to setting changes
  const onSettingChange = async () => {
    const updated = {
      embedTags: settingEmbedTags.checked,
      toasts: settingToasts.checked,
      filenamePattern: settingFilenamePattern.value,
      saveAs: settingSaveAs.checked
    };
    await saveSettings(updated);
    // Broadcast setting update to open tabs
    const tabs = await chrome.tabs.query({ url: "*://music.yandex.ru/*" });
    tabs.forEach(tab => {
      chrome.tabs.sendMessage(tab.id, { action: 'settings_updated', settings: updated }).catch(() => {});
    });
  };

  settingEmbedTags.addEventListener('change', onSettingChange);
  settingToasts.addEventListener('change', onSettingChange);
  settingFilenamePattern.addEventListener('change', onSettingChange);
  settingSaveAs.addEventListener('change', onSettingChange);

  // 2. Query active Yandex Music tab for current playing track
  async function queryActiveTrack() {
    try {
      const tabs = await chrome.tabs.query({ url: "*://music.yandex.ru/*" });
      if (!tabs || tabs.length === 0) {
        statusLabel.textContent = "Вкладка не найдена";
        headerStatus.classList.add('offline');
        trackTitle.textContent = "Яндекс Музыка не открыта";
        trackArtist.textContent = "Откройте music.yandex.ru для начала";
        downloadCurrentBtn.disabled = true;
        downloadBtnText.textContent = "Открыть Яндекс Музыку";
        downloadCurrentBtn.onclick = () => {
          chrome.tabs.create({ url: "https://music.yandex.ru" });
        };
        return;
      }

      // Found active tab
      const targetTab = tabs.find(t => t.active) || tabs[0];
      statusLabel.textContent = "Подключено";
      headerStatus.classList.remove('offline');

      chrome.tabs.sendMessage(targetTab.id, { action: 'get_current_track' }, (response) => {
        if (chrome.runtime.lastError || !response || !response.track) {
          trackTitle.textContent = "Нет активного трека";
          trackArtist.textContent = "Запустите воспроизведение любого трека";
          downloadCurrentBtn.disabled = true;
          return;
        }

        currentTrackData = response.track;
        trackTitle.textContent = currentTrackData.title || "Без названия";
        trackArtist.textContent = currentTrackData.artist || "Неизвестный исполнитель";
        trackAlbum.textContent = currentTrackData.album ? `Альбом: ${currentTrackData.album}` : "";
        if (currentTrackData.coverUrl) {
          trackCover.src = currentTrackData.coverUrl;
        }
        downloadCurrentBtn.disabled = false;
        downloadBtnText.textContent = "Скачать этот трек";
      });
    } catch (e) {
      console.warn("Ошибка проверки вкладки:", e);
    }
  }

  queryActiveTrack();

  // 3. 1-Click Download Current Track
  downloadCurrentBtn.addEventListener('click', async () => {
    if (!currentTrackData) {
      await queryActiveTrack();
      return;
    }

    try {
      downloadCurrentBtn.disabled = true;
      downloadBtnText.textContent = "Загрузка...";

      const tabs = await chrome.tabs.query({ url: "*://music.yandex.ru/*" });
      const targetTab = tabs.find(t => t.active) || tabs[0];

      if (targetTab) {
        chrome.tabs.sendMessage(targetTab.id, { 
          action: 'download_track',
          trackId: currentTrackData.trackId,
          albumId: currentTrackData.albumId,
          title: currentTrackData.title
        }, (res) => {
          downloadCurrentBtn.disabled = false;
          downloadBtnText.textContent = "Скачать этот трек";
        });
      }
    } catch (err) {
      console.error(err);
      downloadCurrentBtn.disabled = false;
      downloadBtnText.textContent = "Ошибка загрузки";
    }
  });

  // 4. Batch Download Current View
  batchDownloadBtn.addEventListener('click', async () => {
    try {
      const tabs = await chrome.tabs.query({ url: "*://music.yandex.ru/*" });
      const targetTab = tabs.find(t => t.active) || tabs[0];
      if (targetTab) {
        chrome.tabs.sendMessage(targetTab.id, { action: 'start_batch_download' });
        window.close();
      }
    } catch (err) {
      console.error(err);
    }
  });
});

/**
 * Yandex Music Downloader — Popup Controller
 * Панель YM-DL MK.III: телеметрия плеера, настройки, скачивание в один клик.
 */

document.addEventListener('DOMContentLoaded', async () => {
  // Элементы
  const statusLabel = document.getElementById('statusLabel');
  const powerLamp = document.getElementById('powerLamp');
  const trackCover = document.getElementById('trackCover');
  const trackTitle = document.getElementById('trackTitle');
  const trackArtist = document.getElementById('trackArtist');
  const trackAlbum = document.getElementById('trackAlbum');
  const downloadCurrentBtn = document.getElementById('downloadCurrentBtn');
  const downloadBtnText = document.getElementById('downloadBtnText');
  const batchDownloadBtn = document.getElementById('batchDownloadBtn');

  // Настройки
  const settingEmbedTags = document.getElementById('settingEmbedTags');
  const settingToasts = document.getElementById('settingToasts');
  const settingFilenamePattern = document.getElementById('settingFilenamePattern');
  const settingFilenameCustom = document.getElementById('settingFilenameCustom');
  const tplTokens = document.getElementById('tplTokens');
  const nameHint = document.getElementById('nameHint');
  const settingSaveAs = document.getElementById('settingSaveAs');

  let currentTrackData = null;

  // 1. Загрузка настроек
  const defaultSettings = {
    embedTags: true,
    toasts: true,
    filenamePattern: 'artist-title',
    filenameTemplate: '{artist} — {title}',
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
  settingFilenameCustom.value = currentSettings.filenameTemplate || defaultSettings.filenameTemplate;
  settingSaveAs.checked = currentSettings.saveAs;
  syncTemplateVisibility();

  function syncTemplateVisibility() {
    const isCustom = settingFilenamePattern.value === 'custom';
    settingFilenameCustom.hidden = !isCustom;
    tplTokens.hidden = !isCustom;
    nameHint.textContent = isCustom ? 'токены подстановки' : 'шаблон сохранения';
  }

  // Сохранение при изменении настроек
  const onSettingChange = async () => {
    const updated = {
      embedTags: settingEmbedTags.checked,
      toasts: settingToasts.checked,
      filenamePattern: settingFilenamePattern.value,
      filenameTemplate: settingFilenameCustom.value.trim() || defaultSettings.filenameTemplate,
      saveAs: settingSaveAs.checked
    };
    await saveSettings(updated);
    // Разослать обновление открытым вкладкам
    const tabs = await chrome.tabs.query({ url: "*://music.yandex.ru/*" });
    tabs.forEach(tab => {
      chrome.tabs.sendMessage(tab.id, { action: 'settings_updated', settings: updated }).catch(() => {});
    });
  };

  settingEmbedTags.addEventListener('change', onSettingChange);
  settingToasts.addEventListener('change', onSettingChange);
  settingFilenamePattern.addEventListener('change', () => { syncTemplateVisibility(); onSettingChange(); });
  settingFilenameCustom.addEventListener('change', onSettingChange);
  settingSaveAs.addEventListener('change', onSettingChange);

  // VU-шкала: состояния
  const vu = document.querySelector('.vu');
  const setVu = (state) => {
    vu.classList.remove('on', 'done', 'err');
    if (state) vu.classList.add(state);
  };

  // 2. Опрос активной вкладки Яндекс Музыки
  async function queryActiveTrack() {
    try {
      const tabs = await chrome.tabs.query({ url: "*://music.yandex.ru/*" });
      if (!tabs || tabs.length === 0) {
        statusLabel.textContent = "Нет связи";
        powerLamp.classList.add('off');
        trackTitle.textContent = "Яндекс Музыка не открыта";
        trackArtist.textContent = "нажмите, чтобы открыть";
        downloadCurrentBtn.disabled = false;
        downloadBtnText.textContent = "Открыть Яндекс Музыку";
        downloadCurrentBtn.onclick = () => {
          chrome.tabs.create({ url: "https://music.yandex.ru" });
        };
        setVu('err');
        return;
      }

      const targetTab = tabs.find(t => t.active) || tabs[0];
      statusLabel.textContent = "Связь есть";
      powerLamp.classList.remove('off');

      chrome.tabs.sendMessage(targetTab.id, { action: 'get_current_track' }, (response) => {
        if (chrome.runtime.lastError || !response || !response.track) {
          trackTitle.textContent = "Нет активного трека";
          trackArtist.textContent = "запустите воспроизведение";
          downloadCurrentBtn.disabled = true;
          setVu(null);
          return;
        }

        currentTrackData = response.track;
        trackTitle.textContent = currentTrackData.title || "Без названия";
        trackArtist.textContent = currentTrackData.artist || "Неизвестный исполнитель";
        trackAlbum.textContent = currentTrackData.album || "";
        if (currentTrackData.coverUrl) {
          trackCover.src = currentTrackData.coverUrl;
        }
        downloadCurrentBtn.disabled = false;
        downloadBtnText.textContent = "Скачать трек";
        setVu(null);
      });
    } catch (e) {
      console.warn("Ошибка проверки вкладки:", e);
    }
  }

  queryActiveTrack();

  // 3. Скачивание текущего трека
  downloadCurrentBtn.addEventListener('click', async () => {
    if (!currentTrackData) {
      await queryActiveTrack();
      return;
    }

    try {
      downloadCurrentBtn.disabled = true;
      downloadBtnText.textContent = "Запись…";
      setVu('on');

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
          downloadBtnText.textContent = "Скачать трек";
          setVu(res ? 'done' : null);
          setTimeout(() => setVu(null), 2500);
        });
      } else {
        downloadCurrentBtn.disabled = false;
        downloadBtnText.textContent = "Скачать трек";
        setVu(null);
      }
    } catch (err) {
      console.error(err);
      downloadCurrentBtn.disabled = false;
      downloadBtnText.textContent = "Ошибка записи";
      setVu('err');
      setTimeout(() => setVu(null), 2500);
    }
  });

  // 4. Пакетная запись
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

  // 5. Баннер обновления
  const updateBanner = document.getElementById('updateBanner');
  const updateVersionChip = document.getElementById('updateVersion');
  const updateNote = document.getElementById('updateNote');
  const updateOpenBtn = document.getElementById('updateOpenBtn');
  const updateDismissBtn = document.getElementById('updateDismissBtn');

  const UPDATE_DISMISS_KEY = 'ymUpdateDismissedVersion';
  const UPDATE_NOTE_DEFAULT = 'Исправления загрузки и стабильность';

  let updateReleaseUrl = '';
  let updateLatestVersion = '';

  const getLocalStorageArea = () => {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        return chrome.storage.local;
      }
    } catch (err) {
      // хранилище недоступно — работаем без сохранения
    }
    return null;
  };

  const normalizeVersion = (value) => String(value || '').trim().replace(/^v/i, '');

  const readDismissedVersion = () => new Promise((resolve) => {
    const storage = getLocalStorageArea();
    if (!storage) {
      resolve('');
      return;
    }
    let settled = false;
    const done = (value) => {
      if (!settled) {
        settled = true;
        resolve(typeof value === 'string' ? value : '');
      }
    };
    try {
      const request = storage.get(UPDATE_DISMISS_KEY, (items) => {
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.lastError) {
          done('');
          return;
        }
        const stored = items && items[UPDATE_DISMISS_KEY];
        done(typeof stored === 'string' ? stored : '');
      });
      if (request && typeof request.then === 'function') {
        request.then((items) => {
          const stored = items && items[UPDATE_DISMISS_KEY];
          done(typeof stored === 'string' ? stored : '');
        }).catch(() => done(''));
      }
    } catch (err) {
      done('');
    }
  });

  const saveDismissedVersion = (version) => {
    const storage = getLocalStorageArea();
    if (!storage) return;
    try {
      const request = storage.set({ [UPDATE_DISMISS_KEY]: version });
      if (request && typeof request.catch === 'function') {
        request.catch(() => {});
      }
    } catch (err) {
      // сохранение не удалось — баннер просто скроется до следующего запуска
    }
  };

  const requestUpdateInfo = () => new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (!settled) {
        settled = true;
        resolve(value && typeof value === 'object' ? value : null);
      }
    };
    try {
      if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
        done(null);
        return;
      }
      const request = chrome.runtime.sendMessage({ action: 'get_update_info' }, (response) => {
        if (typeof chrome.runtime.lastError) {
          done(null);
          return;
        }
        done(response);
      });
      if (request && typeof request.then === 'function') {
        request.then((response) => done(response)).catch(() => done(null));
      }
    } catch (err) {
      done(null);
    }
  });

  const openReleasePage = () => {
    if (!updateReleaseUrl) return;

    const openInBrowserTab = () => {
      try {
        window.open(updateReleaseUrl, '_blank');
      } catch (err) {
        // открыть страницу не удалось
      }
    };

    try {
      if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
        const request = chrome.tabs.create({ url: updateReleaseUrl });
        if (request && typeof request.catch === 'function') {
          request.catch(() => openInBrowserTab());
        }
      } else {
        openInBrowserTab();
      }
    } catch (err) {
      openInBrowserTab();
    }
    window.close();
  };

  const showUpdateBanner = (info) => {
    const latest = String(info.latestVersion || '').trim();
    const current = String(info.currentVersion || '').trim();

    if (!latest || normalizeVersion(latest) === normalizeVersion(current)) return;

    updateLatestVersion = latest;
    updateReleaseUrl = String(info.releaseUrl || '').trim();

    updateVersionChip.textContent = latest.charAt(0).toLowerCase() === 'v' ? latest : `v${latest}`;
    const note = typeof info.releaseNotes === 'string' && info.releaseNotes.trim()
      ? info.releaseNotes.trim()
      : UPDATE_NOTE_DEFAULT;
    updateNote.textContent = note;

    updateOpenBtn.disabled = !updateReleaseUrl;
    updateOpenBtn.title = updateReleaseUrl ? '' : 'Ссылка на обновление недоступна';

    updateBanner.hidden = false;
  };

  const initUpdateBanner = async () => {
    const [info, dismissedVersion] = await Promise.all([
      requestUpdateInfo(),
      readDismissedVersion()
    ]);

    if (!info || info.updateAvailable !== true) return;
    if (normalizeVersion(dismissedVersion) && normalizeVersion(dismissedVersion) === normalizeVersion(info.latestVersion)) return;

    showUpdateBanner(info);
  };

  updateOpenBtn.addEventListener('click', openReleasePage);

  updateDismissBtn.addEventListener('click', () => {
    updateBanner.hidden = true;
    if (updateLatestVersion) {
      saveDismissedVersion(updateLatestVersion);
    }
  });

  initUpdateBanner();
});
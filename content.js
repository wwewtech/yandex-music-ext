/**
 * Yandex Music Downloader — Content Script (Manifest V3)
 * Handles DOM injection, metadata resolution, ID3 tagging, and Fluent UI feedback.
 */

const SALT = 'XGRlBW9FXlekgbPrRHuSiA';

// Dynamic Settings Cache
let appSettings = {
    embedTags: true,
    toasts: true,
    filenamePattern: 'artist-title',
    saveAs: false
};

// Load saved settings
if (chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(appSettings, (items) => {
        if (items) appSettings = { ...appSettings, ...items };
    });
}

// Listen to messages from popup or background
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'get_current_track') {
        const track = getCurrentPlayingTrackInfo();
        sendResponse({ track });
    } else if (request.action === 'download_track') {
        downloadTrackWithMetadata(request.trackId, request.albumId, request.title);
        sendResponse({ status: 'started' });
    } else if (request.action === 'start_batch_download') {
        openBatchDownloadModal();
        sendResponse({ status: 'modal_opened' });
    } else if (request.action === 'settings_updated') {
        appSettings = { ...appSettings, ...request.settings };
        sendResponse({ status: 'ok' });
    }
});

// SVG Icons
const ICONS = {
    download: `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>`,
    downloadSmall: `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>`,
    spinner: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="9" stroke-opacity="0.25"/><path d="M12 3a9 9 0 0 1 9 9" stroke-linecap="round"/></svg>`,
    success: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6L9 17l-5-5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    error: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="9"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`
};

/* ==========================================================================
   Windows 11 Fluent InfoBar / Toast Notification System
   ========================================================================== */

function getOrCreateToastContainer() {
    let container = document.getElementById('ym-ext-toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'ym-ext-toast-container';
        document.body.appendChild(container);
    }
    return container;
}

function showToast({ title, artist, coverUrl, statusText, progress = 30, state = 'loading', duration = 0 }) {
    if (!appSettings.toasts) return null;

    const container = getOrCreateToastContainer();
    const toast = document.createElement('div');
    toast.className = 'ym-ext-toast';

    const fallbackCover = chrome.runtime.getURL('icons/icon48.png');
    const safeCover = coverUrl || fallbackCover;

    toast.innerHTML = `
        <div class="ym-toast-row">
            <img class="ym-toast-cover" src="${safeCover}" alt="Cover">
            <div class="ym-toast-info">
                <div class="ym-toast-title">${escapeHtml(title || 'Трек')}</div>
                <div class="ym-toast-artist">${escapeHtml(artist || 'Яндекс Музыка')}</div>
                <div class="ym-toast-status ym-status-${state}">
                    <span class="ym-status-icon">${state === 'loading' ? ICONS.spinner : state === 'success' ? ICONS.success : ICONS.error}</span>
                    <span class="ym-status-msg">${escapeHtml(statusText)}</span>
                </div>
            </div>
        </div>
        <div class="ym-toast-progress-bar">
            <div class="ym-toast-progress-fill ${progress >= 100 ? 'ym-done' : ''}" style="width: ${progress}%"></div>
        </div>
    `;

    container.appendChild(toast);

    const update = ({ newStatus, newProgress, newState, dismissAfter = 0 }) => {
        if (!toast.parentNode) return;
        const msgEl = toast.querySelector('.ym-status-msg');
        const iconEl = toast.querySelector('.ym-status-icon');
        const statusEl = toast.querySelector('.ym-toast-status');
        const fillEl = toast.querySelector('.ym-toast-progress-fill');

        if (newStatus && msgEl) msgEl.textContent = newStatus;
        if (newState && statusEl) {
            statusEl.className = `ym-toast-status ym-status-${newState}`;
            if (iconEl) iconEl.innerHTML = newState === 'loading' ? ICONS.spinner : newState === 'success' ? ICONS.success : ICONS.error;
        }
        if (newProgress !== undefined && fillEl) {
            fillEl.style.width = `${newProgress}%`;
            if (newProgress >= 100) fillEl.classList.add('ym-done');
        }
        if (dismissAfter > 0) {
            setTimeout(() => {
                toast.classList.add('ym-closing');
                setTimeout(() => toast.remove(), 250);
            }, dismissAfter);
        }
    };

    if (duration > 0) {
        setTimeout(() => {
            toast.classList.add('ym-closing');
            setTimeout(() => toast.remove(), 250);
        }, duration);
    }

    return { toast, update };
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ==========================================================================
   Direct Stream & Metadata Resolution Pipeline
   ========================================================================== */

async function getDownloadUrl(trackId, albumId) {
    const retpath = encodeURIComponent(`https://music.yandex.ru/album/${albumId}/track/${trackId}`);
    const ts = Date.now();
    const trackApiUrl = `https://music.yandex.ru/api/v2.1/handlers/track/${trackId}:${albumId}/web-album_track-track-track-main/download/m?hq=1&external-domain=music.yandex.ru&overembed=no&__t=${ts}`;

    const res1 = await fetch(trackApiUrl, {
        credentials: 'include',
        headers: {
            'Accept': 'application/json, text/javascript, */*; q=0.01',
            'X-Requested-With': 'XMLHttpRequest',
            'X-Retpath-Y': retpath,
            'Referer': `https://music.yandex.ru/album/${albumId}`,
            'X-Yandex-Music-Client': 'YandexMusicAPI/5.0'
        }
    });

    if (!res1.ok) throw new Error(`Сервер вернул ${res1.status} при получении ссылки на поток`);

    const text1 = await res1.text();
    if (!text1 || text1.trim().startsWith('<')) {
        throw new Error('Сервер вернул HTML вместо JSON. Убедитесь, что вы авторизованы на music.yandex.ru');
    }
    const data1 = JSON.parse(text1);

    if (!data1.src) throw new Error('Сервер не вернул ссылку на поток (src)');

    const srcUrl = data1.src + '&format=json';
    const res2 = await fetch(srcUrl, { credentials: 'include' });
    if (!res2.ok) throw new Error(`Ошибка стораджа Яндекс Музыки: ${res2.status}`);

    const text2 = await res2.text();
    if (!text2 || text2.trim().startsWith('<')) throw new Error('Сторадж вернул HTML вместо JSON');
    const data2 = JSON.parse(text2);

    const { host, path, ts: fileTs, s } = data2;
    const sign = md5(SALT + path.substring(1) + s);

    return `https://${host}/get-mp3/${sign}/${fileTs}${path}`;
}

async function fetchBufferViaBackground(url) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ action: 'fetch_data_url', url }, async (response) => {
            if (chrome.runtime.lastError) {
                return reject(chrome.runtime.lastError.message);
            }
            if (response && response.error) {
                return reject(new Error(response.error));
            }
            if (response && response.dataUrl) {
                try {
                    const res = await fetch(response.dataUrl);
                    const buffer = await res.arrayBuffer();
                    resolve(buffer);
                } catch (e) {
                    reject(e);
                }
            } else {
                reject(new Error("Пустой ответ от фонового сервиса"));
            }
        });
    });
}

function formatFilename(title, artists, album) {
    const pattern = appSettings.filenamePattern || 'artist-title';
    let base = '';
    if (pattern === 'title-artist' && artists) {
        base = `${title} — ${artists}`;
    } else if (pattern === 'title-only' || !artists) {
        base = title;
    } else {
        base = `${artists} — ${title}`;
    }
    return base.replace(/[\\/:*?"<>|]/g, "_").trim();
}

async function downloadTrackWithMetadata(trackId, albumId, fallbackTitle, btnElement = null) {
    let toastHandle = null;

    try {
        if (btnElement) {
            btnElement.classList.add('ym-loading');
            btnElement.innerHTML = ICONS.spinner;
            btnElement.disabled = true;
        }

        // 1. Get track metadata
        let trackInfo = null;
        try {
            const metaRes = await fetch(`https://music.yandex.ru/api/v2.1/handlers/tracks?tracks=${trackId}:${albumId}&external-domain=music.yandex.ru&overembed=no`, {
                credentials: 'include',
                headers: {
                    'Accept': 'application/json, text/javascript, */*; q=0.01',
                    'X-Requested-With': 'XMLHttpRequest',
                    'X-Retpath-Y': encodeURIComponent(location.href),
                    'Referer': `https://music.yandex.ru/album/${albumId}`,
                    'X-Yandex-Music-Client': 'YandexMusicAPI/5.0'
                }
            });
            const metaText = await metaRes.text();
            if (metaText && !metaText.trim().startsWith('<')) {
                const metaData = JSON.parse(metaText);
                trackInfo = metaData[0];
            }
        } catch (e) {
            console.warn("Фолбэк базовых метаданных", e);
        }

        let title = fallbackTitle || 'Трек';
        let artists = '';
        let album = '';
        let year = '';
        let coverUrl = '';

        if (trackInfo) {
            title = trackInfo.title || title;
            if (trackInfo.artists && trackInfo.artists.length > 0) {
                artists = trackInfo.artists.map(a => a.name).join(', ');
            }
            if (trackInfo.albums && trackInfo.albums.length > 0) {
                album = trackInfo.albums[0].title || '';
                year = trackInfo.albums[0].year || '';
            }
            if (trackInfo.coverUri) {
                coverUrl = `https://${trackInfo.coverUri.replace('%%', '400x400')}`;
            }
        }

        const fileName = formatFilename(title, artists, album);

        // Toast: Start
        toastHandle = showToast({
            title,
            artist: artists,
            coverUrl,
            statusText: "Подключение к аудиопотоку...",
            progress: 25,
            state: 'loading'
        });

        // 2. Direct download URL
        const downloadUrl = await getDownloadUrl(trackId, albumId);

        // Toast: Streaming MP3
        if (toastHandle) {
            toastHandle.update({
                newStatus: "Загрузка 320 kbps MP3...",
                newProgress: 55,
                newState: 'loading'
            });
        }

        // 3. Fetch MP3 Buffer
        const mp3Buffer = await fetchBufferViaBackground(downloadUrl);

        let finalBuffer = mp3Buffer;

        // 4. Tagging with ID3v2 if enabled
        if (appSettings.embedTags) {
            if (toastHandle) {
                toastHandle.update({
                    newStatus: "Вшивание ID3v2 тегов и обложки...",
                    newProgress: 80,
                    newState: 'loading'
                });
            }

            let coverBuffer = null;
            if (coverUrl) {
                try {
                    coverBuffer = await fetchBufferViaBackground(coverUrl);
                } catch(e) {
                    console.warn('Не удалось скачать обложку', e);
                }
            }

            try {
                const writer = new window.ID3Writer(mp3Buffer);
                writer.addTextFrame('TIT2', title);
                if (artists) writer.addTextFrame('TPE1', artists);
                if (album) writer.addTextFrame('TALB', album);
                if (year) writer.addTextFrame('TYER', year.toString());
                if (coverBuffer) writer.addPictureFrame(coverBuffer, 'image/jpeg');

                finalBuffer = writer.getTaggedBuffer();
            } catch (err) {
                console.warn("Ошибка генератора ID3Writer, сохраняем исходный буфер:", err);
            }
        }

        // 5. Send blob to Chrome Downloads API
        const blob = new Blob([finalBuffer], { type: 'audio/mp3' });
        const blobUrl = URL.createObjectURL(blob);

        chrome.runtime.sendMessage({ 
            action: 'download', 
            url: blobUrl, 
            filename: fileName,
            saveAs: appSettings.saveAs
        });

        setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);

        // Toast: Success
        if (toastHandle) {
            toastHandle.update({
                newStatus: "Сохранено в папку Загрузки!",
                newProgress: 100,
                newState: 'success',
                dismissAfter: 4000
            });
        }

        if (btnElement) {
            btnElement.classList.remove('ym-loading');
            btnElement.classList.add('ym-success');
            btnElement.innerHTML = ICONS.success;
            setTimeout(() => {
                btnElement.classList.remove('ym-success');
                btnElement.innerHTML = btnElement.id === 'ym-ext-download-btn' ? ICONS.download : ICONS.downloadSmall;
                btnElement.disabled = false;
            }, 2000);
        }

    } catch (e) {
        console.error("Ошибка скачивания трека:", e);
        if (toastHandle) {
            toastHandle.update({
                newStatus: "Ошибка: " + (e.message || "сбой загрузки"),
                newProgress: 100,
                newState: 'error',
                dismissAfter: 5000
            });
        }
        if (btnElement) {
            btnElement.classList.remove('ym-loading');
            btnElement.classList.add('ym-error');
            btnElement.innerHTML = ICONS.error;
            setTimeout(() => {
                btnElement.classList.remove('ym-error');
                btnElement.innerHTML = btnElement.id === 'ym-ext-download-btn' ? ICONS.download : ICONS.downloadSmall;
                btnElement.disabled = false;
            }, 2000);
        }
    }
}

/* ==========================================================================
   DOM Track Detection & Injections
   ========================================================================== */

function getCurrentPlayingTrackInfo() {
    const playerArea = document.querySelector('[class*="PlayerBar"]') || document.querySelector('[class*="player"]') || document.body;
    const trackLinks = Array.from(playerArea.querySelectorAll('a[href*="/album/"][href*="/track/"]'));
    
    const trackLink = trackLinks.find(a => {
        const match = a.getAttribute('href').match(/\/album\/(\d+)\/track\/(\d+)/);
        return match && match[1] && match[2] && a.textContent.trim().length > 0;
    });

    if (!trackLink) return null;

    const match = trackLink.getAttribute('href').match(/\/album\/(\d+)\/track\/(\d+)/);
    const albumId = match[1];
    const trackId = match[2];
    const title = trackLink.textContent.trim();

    const trackContainer = trackLink.closest('[class*="description"]') || trackLink.closest('[class*="track-info"]') || trackLink.parentNode.parentNode;
    let artist = '';
    if (trackContainer) {
        const artistLinks = trackContainer.querySelectorAll('a[href*="/artist/"]');
        artist = Array.from(artistLinks).map(a => a.textContent.trim()).join(', ');
    }

    let coverUrl = '';
    const coverImg = playerArea.querySelector('img[class*="cover"], img[class*="Cover"], [class*="cover"] img');
    if (coverImg && coverImg.src) {
        coverUrl = coverImg.src;
    }

    return { trackId, albumId, title, artist, coverUrl };
}

function injectDownloadButton() {
    if (document.getElementById('ym-ext-download-btn')) return;

    let targetContainer = null;
    let insertMethod = 'append';

    targetContainer = document.querySelector('.PlayerBarDesktopWithBackgroundProgressBar_sonata__mGFb_') || 
                      document.querySelector('[class*="PlayerBar"] [class*="sonata"]');
                      
    if (!targetContainer) {
        const likeBtn = document.querySelector('[class*="Player"] button[aria-label="Мне нравится"], [class*="Player"] button[title="Мне нравится"], [class*="player"] button[aria-label="Like"]');
        if (likeBtn && likeBtn.parentNode) {
            targetContainer = likeBtn;
            insertMethod = 'after';
        }
    }
    
    if (!targetContainer) return;

    const btn = document.createElement('button');
    btn.id = 'ym-ext-download-btn';
    btn.setAttribute('aria-label', 'Скачать в MP3 320 kbps');
    btn.setAttribute('title', 'Скачать трек в MP3 (320 kbps HQ + ID3v2)');
    btn.innerHTML = ICONS.download;

    btn.onclick = async () => {
        const info = getCurrentPlayingTrackInfo();
        if (!info) {
            showToast({
                title: "Нет активного трека",
                artist: "Запустите воспроизведение трека в плеере",
                statusText: "Не удалось определить трек",
                progress: 100,
                state: 'error',
                duration: 3500
            });
            return;
        }
        await downloadTrackWithMetadata(info.trackId, info.albumId, info.title, btn);
    };

    if (insertMethod === 'append') {
        targetContainer.appendChild(btn);
    } else if (insertMethod === 'after' && targetContainer.parentNode) {
        targetContainer.parentNode.insertBefore(btn, targetContainer.nextSibling);
    }
}

function injectListDownloadButtons() {
    const trackRows = document.querySelectorAll('[class*="CommonTrack_root"], [class*="TrackPlaylist_track"], [class*="d-track "], .d-track');

    trackRows.forEach(row => {
        if (row.querySelector('.ym-ext-list-download-btn')) return;

        const controlsBar = row.querySelector('[class*="CommonControlsBar_controls"], [class*="TrackPlaylist_controlsBarCell"], .d-track__actions');
        if (!controlsBar) return;

        const trackLink = row.querySelector('a[href*="/album/"][href*="/track/"]');
        if (!trackLink) return;

        const match = trackLink.getAttribute('href').match(/\/album\/(\d+)\/track\/(\d+)/);
        if (!match) return;

        const albumId = match[1];
        const trackId = match[2];

        const btn = document.createElement('button');
        btn.className = 'ym-ext-list-download-btn';
        btn.setAttribute('aria-label', 'Скачать трек в MP3 320 kbps');
        btn.setAttribute('title', 'Скачать трек (320 kbps HQ)');
        btn.innerHTML = ICONS.downloadSmall;

        btn.onclick = async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const trackTitle = trackLink.textContent.trim() || row.getAttribute('aria-label') || 'Трек';
            await downloadTrackWithMetadata(trackId, albumId, trackTitle, btn);
        };

        if (controlsBar.firstChild) {
            controlsBar.insertBefore(btn, controlsBar.firstChild);
        } else {
            controlsBar.appendChild(btn);
        }
    });
}

function injectBatchHeaderButton() {
    if (document.getElementById('ym-ext-batch-header-btn')) return;

    // Look for album or playlist header action buttons
    const headerActions = document.querySelector('[class*="PageHeader_actions"], [class*="Header_controls"], .page-album__actions, .page-playlist__actions');
    if (!headerActions) return;

    const btn = document.createElement('button');
    btn.id = 'ym-ext-batch-header-btn';
    btn.className = 'ym-ext-batch-header-btn';
    btn.innerHTML = `
        ${ICONS.downloadSmall}
        <span>Скачать всё</span>
    `;

    btn.onclick = () => {
        openBatchDownloadModal();
    };

    headerActions.appendChild(btn);
}

/* ==========================================================================
   Batch Queue Manager Modal
   ========================================================================== */

function openBatchDownloadModal() {
    if (document.getElementById('ym-ext-batch-modal')) return;

    const trackRows = Array.from(document.querySelectorAll('[class*="CommonTrack_root"], [class*="TrackPlaylist_track"], [class*="d-track "], .d-track'));
    const trackItems = [];

    trackRows.forEach(row => {
        const link = row.querySelector('a[href*="/album/"][href*="/track/"]');
        if (link) {
            const match = link.getAttribute('href').match(/\/album\/(\d+)\/track\/(\d+)/);
            if (match) {
                trackItems.push({
                    albumId: match[1],
                    trackId: match[2],
                    title: link.textContent.trim() || 'Трек'
                });
            }
        }
    });

    if (trackItems.length === 0) {
        showToast({
            title: "Треки не найдены",
            artist: "Откройте страницу альбома или плейлиста",
            statusText: "В списке нет доступных треков",
            progress: 100,
            state: 'error',
            duration: 3500
        });
        return;
    }

    const modal = document.createElement('div');
    modal.id = 'ym-ext-batch-modal';
    modal.innerHTML = `
        <div class="ym-batch-box">
            <div class="ym-batch-header">
                <div class="ym-batch-title">Пакетное скачивание</div>
                <button class="ym-batch-close" id="ymBatchClose">&times;</button>
            </div>
            <div>Найдено треков для загрузки: <strong>${trackItems.length}</strong></div>
            <div class="ym-batch-progress" style="display:none;" id="ymBatchProgressBlock">
                <div class="ym-batch-progress-text">
                    <span id="ymBatchStatus">Загрузка...</span>
                    <span id="ymBatchCount">0 / ${trackItems.length}</span>
                </div>
                <div class="ym-batch-bar">
                    <div class="ym-batch-bar-fill" id="ymBatchBarFill"></div>
                </div>
            </div>
            <div class="ym-batch-footer">
                <button class="ym-batch-btn ym-batch-btn-cancel" id="ymBatchCancel">Отмена</button>
                <button class="ym-batch-btn ym-batch-btn-start" id="ymBatchStart">Начать (${trackItems.length} треков)</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    const closeModal = () => modal.remove();
    document.getElementById('ymBatchClose').onclick = closeModal;
    document.getElementById('ymBatchCancel').onclick = closeModal;

    let isRunning = false;
    document.getElementById('ymBatchStart').onclick = async () => {
        if (isRunning) return;
        isRunning = true;

        const startBtn = document.getElementById('ymBatchStart');
        const progressBlock = document.getElementById('ymBatchProgressBlock');
        const statusEl = document.getElementById('ymBatchStatus');
        const countEl = document.getElementById('ymBatchCount');
        const barFill = document.getElementById('ymBatchBarFill');

        startBtn.style.display = 'none';
        progressBlock.style.display = 'flex';

        for (let i = 0; i < trackItems.length; i++) {
            if (!document.getElementById('ym-ext-batch-modal')) break; // Closed

            const item = trackItems[i];
            statusEl.textContent = `Загрузка: ${item.title}`;
            countEl.textContent = `${i + 1} / ${trackItems.length}`;
            barFill.style.width = `${Math.round(((i + 1) / trackItems.length) * 100)}%`;

            try {
                await downloadTrackWithMetadata(item.trackId, item.albumId, item.title);
            } catch (err) {
                console.warn(`Ошибка скачивания [${item.title}]:`, err);
            }

            // Graceful delay (1.2s) between tracks to prevent rate limiting
            await new Promise(r => setTimeout(r, 1200));
        }

        statusEl.textContent = "Все треки успешно загружены!";
        setTimeout(closeModal, 2000);
    };
}

// SPA Routing Observer
const observer = new MutationObserver(() => {
    injectDownloadButton();
    injectListDownloadButtons();
    injectBatchHeaderButton();
});

observer.observe(document.body, { childList: true, subtree: true });

// Initial injection run
injectDownloadButton();
injectListDownloadButtons();
injectBatchHeaderButton();
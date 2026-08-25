/**
 * Yandex Music Downloader — Content Script (Manifest V3)
 * Handles DOM injection, metadata resolution, ID3 tagging, and Fluent UI feedback.
 */

const SALT = 'XGRlBW9FXlekgbPrRHuSiA';

const fileInfoCache = {};

document.addEventListener('ym-ext-file-info', (event) => {
    const detail = event && event.detail;
    if (!detail || !detail.trackId || !detail.info) return;
    fileInfoCache[String(detail.trackId)] = {
        info: detail.info,
        ts: Date.now()
    };
});

// OAuth token captured by inject.js (MAIN world) from real page requests
document.addEventListener('ym-ext-token', (event) => {
    const detail = event && event.detail;
    if (!detail || !detail.token) return;
    try {
        chrome.storage.local.set({
            ymToken: detail.token,
            ymTokenAt: Date.now()
        });
    } catch (_) {}
});

async function getYmToken() {
    return new Promise((resolve) => {
        try {
            chrome.storage.local.get(['ymToken'], (items) => {
                resolve((items && items.ymToken) || '');
            });
        } catch (_) {
            resolve('');
        }
    });
}

function getCachedFileInfo(trackId) {
    const entry = fileInfoCache[String(trackId)];
    if (!entry) return null;
    if (Date.now() - entry.ts > 5 * 60 * 1000) return null;
    return entry.info;
}

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

    const fallbackCover = getExtensionAssetUrl('icons/icon48.png');
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

function getExtensionAssetUrl(path) {
    try {
        return chrome.runtime.getURL(path);
    } catch (e) {
        if (isExtensionContextInvalidated(e)) {
            // Data URI fallback keeps toast rendering even with stale content-script context.
            return 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
        }
        return path;
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ==========================================================================
   Direct Stream & Metadata Resolution Pipeline
   ========================================================================== */

function sendBackgroundMessage(payload) {
    return new Promise((resolve, reject) => {
        try {
            chrome.runtime.sendMessage(payload, (response) => {
                const err = chrome.runtime.lastError;
                if (err) {
                    if (isExtensionContextInvalidated(err)) {
                        reject(new Error('Перезагрузите страницу (Ctrl+F5) после обновления расширения'));
                        return;
                    }
                    reject(new Error(err.message));
                    return;
                }
                if (response && response.error) {
                    reject(new Error(response.error));
                    return;
                }
                resolve(response || {});
            });
        } catch (e) {
            reject(e);
        }
    });
}

async function resolveTrackDownload(trackId, albumId, options = {}) {
    const tid = String(trackId);

    const cached = getCachedFileInfo(tid);
    if (cached && cached.url) {
        return cached;
    }

    if (options.forceWarmup) {
        await autoWarmupTrack(trackId, albumId);
        const warmed = getCachedFileInfo(tid);
        if (warmed && warmed.url) return warmed;
    }

    const signedUrl = findSignedGetFileInfoUrl(tid);
    const token = await getYmToken();

    try {
        const { info } = await sendBackgroundMessage({
            action: 'resolve_track_download',
            trackId: String(trackId),
            signedUrl,
            token
        });
        if (info && info.url) return info;
    } catch (e) {
        if (!options.allowRetry) throw e;
    }

    if (!options.forceWarmup) {
        await autoWarmupTrack(trackId, albumId);
        return resolveTrackDownload(trackId, albumId, { forceWarmup: false, allowRetry: false });
    }

    throw new Error('Не удалось получить ссылку на трек. Проверьте авторизацию на music.yandex.ru');
}

/* ---- Управление качеством плеера (для получения FLAC/320) ---------------- */

function isHighQualityInfo(info) {
    if (!info) return false;
    const codec = String(info.codec || '').toLowerCase();
    return codec.includes('flac') || /mp3/.test(codec);
}

async function setPlayerQuality(preferExcellent) {
    try {
        const btn = Array.from(document.querySelectorAll('button'))
            .find(b => b.getAttribute('aria-label') === 'Настройки звука');
        if (!btn) return false;
        btn.click();
        await new Promise(r => setTimeout(r, 900));

        const options = Array.from(document.querySelectorAll('[role="option"]'));
        if (!options.length) { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); return false; }

        const target = preferExcellent
            ? options.find(el => /Превосходное/.test(el.textContent))
            : options.find(el => /Оптимальное/.test(el.textContent));
        if (target) target.click();
        await new Promise(r => setTimeout(r, 400));
        return true;
    } catch (_) {
        return false;
    }
}

/**
 * Если перехваченный вариант низкого качества — временно включает «Превосходное»
 * в плеере, прогревает трек (плеер сам запрашивает get-file-info с hq/lossless),
 * и возвращает лучший вариант из кэша. Настройку пользователя возвращает обратно.
 */
async function upgradeQualityViaPlayer(trackId, albumId) {
    const current = getCachedFileInfo(trackId);
    if (current && isHighQualityInfo(current)) return current;

    const switched = await setPlayerQuality(true);
    if (!switched) return current;

    try {
        await autoWarmupTrack(trackId, albumId);
    } finally {
        // возвращаем прежнюю настройку качества
        setTimeout(() => { setPlayerQuality(false); }, 500);
    }

    const upgraded = getCachedFileInfo(trackId);
    return (upgraded && isHighQualityInfo(upgraded)) ? upgraded : (upgraded || current);
}

async function autoWarmupTrack(trackId, albumId) {
    const tid = String(trackId);
    const aid = albumId ? String(albumId) : null;

    const beforeUrl = findSignedGetFileInfoUrl(tid);
    if (beforeUrl) return true;

    let toggledPlayback = false;
    try {
        const linkSelector = aid
            ? `a[href*="/album/${aid}/track/${tid}"]`
            : `a[href*="/track/${tid}"]`;
        const trackLink = document.querySelector(linkSelector);
        const row = trackLink ? trackLink.closest('[class*="CommonTrack_root"], [class*="TrackPlaylist_track"], .d-track') : null;
        const rowPlayBtn = row ? row.querySelector('button[aria-label*="Слушать"], button[aria-label*="Play"], button[title*="Слушать"], button[title*="Play"]') : null;

        if (rowPlayBtn) {
            rowPlayBtn.click();
            toggledPlayback = true;
        } else {
            const globalPlayBtn = document.querySelector('button[aria-label*="Пауза"], button[aria-label*="Play"], button[aria-label*="Воспроизвести"]');
            if (globalPlayBtn) {
                globalPlayBtn.click();
                toggledPlayback = true;
            }
        }

        for (let i = 0; i < 5; i++) {
            await new Promise((r) => setTimeout(r, 600));
            const signedUrl = findSignedGetFileInfoUrl(tid);
            if (signedUrl) return true;
        }
    } catch (_) {
        return false;
    } finally {
        if (toggledPlayback) {
            try {
                const pauseBtn = document.querySelector('button[aria-label*="Пауза"], button[title*="Пауза"]');
                if (pauseBtn) pauseBtn.click();
            } catch (_) {}
        }
    }

    return false;
}

async function getAudioDurationSeconds(arrayBuffer) {
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return null;
        const ctx = new AudioCtx();
        const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
        const duration = decoded && Number.isFinite(decoded.duration) ? decoded.duration : null;
        await ctx.close();
        return duration;
    } catch (_) {
        return null;
    }
}

function isLikelyPreviewByDuration(actualSec, expectedMs) {
    const expectedSec = Number(expectedMs || 0) / 1000;
    if (!actualSec || !expectedSec || expectedSec < 75) return false;

    // Typical clipped previews are around 30 seconds.
    if (actualSec <= 35 && expectedSec >= 90) return true;
    return actualSec < expectedSec * 0.6;
}

function findSignedGetFileInfoUrl(trackId) {
    const tid = String(trackId);
    const entries = performance.getEntriesByType('resource');
    for (let i = entries.length - 1; i >= 0; i--) {
        const url = entries[i] && entries[i].name;
        if (!url || !url.includes('api.music.yandex.ru/get-file-info')) continue;
        try {
            const parsed = new URL(url);
            const qTrackId = parsed.searchParams.get('trackId');
            const qTrackIds = parsed.searchParams.get('trackIds');
            if (qTrackId === tid) return url;
            if (qTrackIds && qTrackIds.split(',').map(v => v.trim()).includes(tid)) return url;
        } catch (_) {}
    }
    return null;
}

function base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}

function arrayBufferToBase64(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
}

function isExtensionContextInvalidated(error) {
    const message = String(error?.message || error || '').toLowerCase();
    return message.includes('extension context invalidated');
}

async function fetchBufferViaBackground(url) {
    return new Promise((resolve, reject) => {
        try {
            chrome.runtime.sendMessage({ action: 'fetch_data_url', url }, async (response) => {
                if (chrome.runtime.lastError) {
                    if (isExtensionContextInvalidated(chrome.runtime.lastError)) {
                        try {
                            const directRes = await fetch(url, { credentials: 'include' });
                            if (!directRes.ok) throw new Error(`HTTP ${directRes.status}: ${directRes.statusText}`);
                            resolve(await directRes.arrayBuffer());
                        } catch (directErr) {
                            reject(directErr);
                        }
                        return;
                    }
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
        } catch (e) {
            if (isExtensionContextInvalidated(e)) {
                fetch(url, { credentials: 'include' })
                    .then((res) => {
                        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
                        return res.arrayBuffer();
                    })
                    .then(resolve)
                    .catch(reject);
                return;
            }
            reject(e);
        }
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

        // 1. Get track metadata from api.music.yandex.ru (this endpoint still works)
        let trackInfo = null;
        try {
            const metaRes = await fetch(`https://api.music.yandex.ru/tracks?trackIds=${trackId}`, {
                credentials: 'include',
                headers: { 'Accept': 'application/json' }
            });
            if (metaRes.ok) {
                const metaData = await metaRes.json();
                // Response: { result: [ {...track} ] }
                const items = metaData?.result || metaData;
                trackInfo = Array.isArray(items) ? items[0] : items;
            }
        } catch (e) {
            console.warn('Metadata fetch failed:', e);
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
            statusText: 'Получение ссылки на трек...',
            progress: 15,
            state: 'loading'
        });

        if (toastHandle) {
            toastHandle.update({ newStatus: 'Запрос ссылки через API Яндекса...', newProgress: 30 });
        }

        let downloadInfo = await resolveTrackDownload(trackId, albumId, { allowRetry: true });

        // Если перехвачено низкое качество — пробуем поднять до FLAC/320 через плеер
        if (!isHighQualityInfo(downloadInfo)) {
            if (toastHandle) {
                toastHandle.update({ newStatus: 'Запрос максимального качества...', newProgress: 40 });
            }
            try {
                const upgraded = await upgradeQualityViaPlayer(trackId, albumId);
                if (upgraded && upgraded.url) downloadInfo = upgraded;
            } catch (_) {}
        }

        const qualityLabel = downloadInfo.codec
            ? String(downloadInfo.codec).toUpperCase()
            : (downloadInfo.key ? 'AAC' : 'MP3');

        if (toastHandle) {
            toastHandle.update({
                newStatus: `Загрузка (${qualityLabel})...`,
                newProgress: 55,
                newState: 'loading'
            });
        }

        const durationMs = trackInfo && trackInfo.durationMs ? trackInfo.durationMs : 0;

        // Скачиваем байты (background расшифровывает encraw при необходимости)
        const fetched = await sendBackgroundMessage({
            action: 'fetch_track_bytes',
            url: downloadInfo.url,
            key: downloadInfo.key,
            expectedSize: downloadInfo.size,
            codec: downloadInfo.codec
        });
        if (fetched && fetched.error) throw new Error(fetched.error);

        let audioBuffer = base64ToArrayBuffer(fetched.bytes);
        const container = fetched.container || 'unknown';
        const ext = fetched.ext || 'mp3';
        const decodedSec = await getAudioDurationSeconds(audioBuffer);

        if (isLikelyPreviewByDuration(decodedSec, durationMs)) {
            throw new Error('Получен только превью-фрагмент (~30с). Попробуйте нажать Play и скачать снова.');
        }

        // Тегирование для всех контейнеров: MP3 → ID3v2, M4A → ilst, FLAC → Vorbis
        if (appSettings.embedTags) {
            if (toastHandle) {
                toastHandle.update({
                    newStatus: 'Вшивание тегов и обложки...',
                    newProgress: 80,
                    newState: 'loading'
                });
            }

            let coverBuffer = null;
            if (coverUrl) {
                try {
                    coverBuffer = await fetchBufferViaBackground(coverUrl);
                } catch (e) {
                    console.warn('Не удалось скачать обложку', e);
                }
            }

            try {
                if (container === 'mp3') {
                    const writer = new window.ID3Writer(audioBuffer);
                    writer.addTextFrame('TIT2', title);
                    if (artists) writer.addTextFrame('TPE1', artists);
                    if (album) writer.addTextFrame('TALB', album);
                    if (year) writer.addTextFrame('TYER', year.toString());
                    if (coverBuffer) writer.addPictureFrame(coverBuffer, 'image/jpeg');
                    audioBuffer = writer.getTaggedBuffer();
                } else if ((container === 'm4a' || container === 'flac') && window.YMTagWriters) {
                    audioBuffer = window.YMTagWriters.detectAndTag(audioBuffer, container, {
                        title, artist: artists, album, year: year ? String(year) : '', cover: coverBuffer
                    });
                }
            } catch (err) {
                console.warn('Tagging error:', err);
            }
        }

        // В content script MV3 нет URL.createObjectURL — скачивание идёт через
        // offscreen-документ расширения (см. offscreen.js).
        let savedFilename = `${fileName}.${ext}`;

        if (toastHandle) {
            toastHandle.update({
                newStatus: 'Сохранение файла...',
                newProgress: 90,
                newState: 'loading'
            });
        }

        const mimeMap = { mp3: 'audio/mpeg', m4a: 'audio/mp4', flac: 'audio/flac' };
        const dlResult = await sendBackgroundMessage({
            action: 'download_bytes',
            bytesBase64: arrayBufferToBase64(audioBuffer),
            filename: savedFilename,
            mime: mimeMap[ext] || 'application/octet-stream',
            saveAs: appSettings.saveAs
        });
        if (dlResult && dlResult.error) throw new Error(dlResult.error);

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
    btn.setAttribute('aria-label', 'Скачать трек');
    btn.setAttribute('title', 'Скачать трек (максимальное качество + теги и обложка)');
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
        btn.setAttribute('aria-label', 'Скачать трек');
        btn.setAttribute('title', 'Скачать трек (максимальное качество)');
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
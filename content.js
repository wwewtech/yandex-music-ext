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

// Оценка качества: чем выше, тем лучше. Lossless ценнее всего.
function qualityRank(info) {
    if (!info) return -1;
    const codec = String(info.codec || '').toLowerCase();
    let base = 0;
    if (codec === 'flac') base = 5000;
    else if (codec.includes('flac')) base = 4000;
    else if (codec.includes('mp3')) base = 3000;
    else if (codec.includes('he-aac')) base = 1000;
    else base = 2000; // aac / aac-mp4
    return base + Math.min(Number(info.bitrate || info.bitrateInKbps || 0), 2000) / 10;
}

function isHighQualityInfo(info) {
    return qualityRank(info) >= 3000; // mp3 320 или лучше
}

function isLosslessInfo(info) {
    const codec = String(info?.codec || '').toLowerCase();
    return codec.includes('flac');
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
        // force=true: трек мог уже быть «прогрет» в низком качестве —
        // после смены качества нужно запустить его заново
        await autoWarmupTrack(trackId, albumId, true);
    } finally {
        // возвращаем прежнюю настройку качества
        setTimeout(() => { setPlayerQuality(false); }, 500);
    }

    const upgraded = getCachedFileInfo(trackId);
    return (upgraded && isHighQualityInfo(upgraded)) ? upgraded : (upgraded || current);
}

async function autoWarmupTrack(trackId, albumId, force = false) {
    const tid = String(trackId);
    const aid = albumId ? String(albumId) : null;

    if (!force) {
        const beforeUrl = findSignedGetFileInfoUrl(tid);
        if (beforeUrl) return true;
    }

    let toggledPlayback = false;
    try {
        const linkSelector = aid
            ? `a[href*="/album/${aid}/track/${tid}"]`
            : `a[href*="/track/${tid}"]`;
        const trackLink = document.querySelector(linkSelector);
        const row = trackLink ? trackLink.closest('[class*="CommonTrack_root"], [class*="TrackPlaylist_track"], .d-track') : null;
        const rowPlayBtn = row ? row.querySelector('button[aria-label*="Слушать"], button[aria-label*="Воспроизведение"], button[aria-label*="Play"], button[title*="Слушать"], button[title*="Play"]') : null;

        if (rowPlayBtn) {
            rowPlayBtn.click();
            toggledPlayback = true;
        } else {
            const globalPlayBtn = document.querySelector('button[aria-label*="Пауза"], button[aria-label*="Воспроизведение"], button[aria-label*="Play"], button[title*="Воспроизведение"]');
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
                const pauseBtn = document.querySelector('button[aria-label*="Пауза"], button[aria-label*="Пауз"], button[title*="Пауза"]');
                if (pauseBtn) pauseBtn.click();
            } catch (_) {}
        }
    }

    return false;
}

/* ==========================================================================
   Tag Writers: M4A (MP4 ilst) и FLAC (Vorbis Comment + Picture)
   ========================================================================== */

const YMTag = (function () {
    'use strict';

    function u32(v) { return [(v >>> 24) & 0xFF, (v >>> 16) & 0xFF, (v >>> 8) & 0xFF, v & 0xFF]; }

    function ascii(str) {
        const out = new Uint8Array(str.length);
        for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xFF;
        return out;
    }

    function utf8(str) { return new TextEncoder().encode(String(str || '')); }

    function concat(chunks) {
        let total = 0;
        for (const c of chunks) total += c.length;
        const out = new Uint8Array(total);
        let off = 0;
        for (const c of chunks) { out.set(c, off); off += c.length; }
        return out;
    }

    function bytesToU32(b, o) { return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0; }
    function bytesToU64(b, o) {
        return bytesToU32(b, o) * 0x100000000 + bytesToU32(b, o + 4);
    }

    /* ------------------------------ MP4 / M4A ------------------------------ */

    function buildDataAtom(typeFlags, payloadBytes) {
        const body = concat([u32(typeFlags), [0, 0, 0, 0], payloadBytes]);
        return concat([u32(body.length + 8), ascii('data'), body]);
    }

    function buildIlstAtom(name, inner) {
        const body = concat([ascii(name), inner]);
        return concat([u32(body.length + 8), body]);
    }

    const MP4_TEXT_FLAGS = 0x00000001;
    const MP4_JPEG_FLAGS = 0x0000000D;
    const MP4_PNG_FLAGS = 0x0000000E;

    function buildIlstPayload(tags) {
        const atoms = [];
        const addText = (name, value) => {
            if (!value) return;
            atoms.push(buildIlstAtom(name, buildDataAtom(MP4_TEXT_FLAGS, utf8(value))));
        };
        addText('\u00A9nam', tags.title);
        addText('\u00A9ART', tags.artist);
        addText('aART', tags.artist);
        addText('\u00A9alb', tags.album);
        addText('\u00A9day', tags.year);
        if (tags.cover) {
            const isPng = tags.cover.length > 8 &&
                tags.cover[0] === 0x89 && tags.cover[1] === 0x50 && tags.cover[2] === 0x4E && tags.cover[3] === 0x47;
            atoms.push(buildIlstAtom('covr', buildDataAtom(isPng ? MP4_PNG_FLAGS : MP4_JPEG_FLAGS, tags.cover)));
        }
        return concat(atoms);
    }

    function walkAtoms(bytes, start, end, cb) {
        let off = start;
        while (off + 8 <= end) {
            let size = bytesToU32(bytes, off);
            const name = String.fromCharCode(bytes[off + 4], bytes[off + 5], bytes[off + 6], bytes[off + 7]);
            let header = 8;
            if (size === 1) {
                size = bytesToU64(bytes, off + 8);
                header = 16;
            } else if (size === 0) {
                size = end - off;
            }
            if (size < header || off + size > end) break;
            cb(name, off, size, header);
            off += size;
        }
    }

    function findChunkOffsetEntries(bytes, start, end, out) {
        walkAtoms(bytes, start, end, (name, off, size, header) => {
            if (name === 'stco' || name === 'co64') {
                const entryCountOff = off + header + 4;
                const count = bytesToU32(bytes, entryCountOff);
                out.push({ tableOff: entryCountOff + 4, count, isCo64: name === 'co64' });
            }
        });
    }

    function findChunkOffsets(bytes, start, end, out) {
        walkAtoms(bytes, start, end, (name, off, size, header) => {
            const bodyStart = off + header;
            if (name === 'moov' || name === 'trak' || name === 'mdia' || name === 'minf' || name === 'stbl') {
                findChunkOffsetEntries(bytes, bodyStart, off + size, out);
            }
        });
    }

    function tagM4a(arrayBuffer, tags) {
        const src = new Uint8Array(arrayBuffer);
        if (src.length < 16) throw new Error('Файл слишком мал для MP4');

        let moovOff = -1, moovSize = 0;
        walkAtoms(src, 0, src.length, (name, off, size) => {
            if (name === 'moov') { moovOff = off; moovSize = size; }
        });
        if (moovOff < 0) throw new Error('MP4: атом moov не найден');

        let udtaOff = -1, udtaSize = 0, metaOff = -1, metaSize = 0, metaHeader = 8;
        walkAtoms(src, moovOff + 8, moovOff + moovSize, (name, off, size) => {
            if (name === 'udta') { udtaOff = off; udtaSize = size; }
        });
        if (udtaOff >= 0) {
            walkAtoms(src, udtaOff + 8, udtaOff + udtaSize, (name, off, size, header) => {
                if (name === 'meta') { metaOff = off; metaSize = size; metaHeader = header; }
            });
        }

        const newIlstPayload = buildIlstPayload(tags);
        const newMetaBody = concat([[0, 0, 0, 0], u32(newIlstPayload.length + 8), ascii('ilst'), newIlstPayload]);
        const newMeta = concat([u32(newMetaBody.length + 8), ascii('meta'), newMetaBody]);
        const newUdta = concat([u32(newMeta.length + 8), ascii('udta'), newMeta]);

        let insertAt, removeStart = -1, removeEnd = -1;
        if (udtaOff >= 0) {
            removeStart = udtaOff; removeEnd = udtaOff + udtaSize;
            insertAt = udtaOff;
        } else {
            insertAt = moovOff + moovSize;
        }

        const delta = newUdta.length - (removeStart >= 0 ? removeEnd - removeStart : 0);

        const parts = [src.subarray(0, insertAt)];
        if (removeStart >= 0 && removeEnd > removeStart) {
            parts.push(newUdta);
            parts.push(src.subarray(removeEnd));
        } else {
            parts.push(newUdta);
            parts.push(src.subarray(insertAt));
        }
        const out = concat(parts);

        const newMoovSize = moovSize + delta;
        out[moovOff] = (newMoovSize >>> 24) & 0xFF;
        out[moovOff + 1] = (newMoovSize >>> 16) & 0xFF;
        out[moovOff + 2] = (newMoovSize >>> 8) & 0xFF;
        out[moovOff + 3] = newMoovSize & 0xFF;

        if (delta !== 0) {
            const refs = [];
            findChunkOffsets(out, moovOff, moovOff + newMoovSize, refs);
            for (const ref of refs) {
                for (let i = 0; i < ref.count; i++) {
                    const p = ref.tableOff + i * (ref.isCo64 ? 8 : 4);
                    if (ref.isCo64) {
                        const v = bytesToU64(out, p);
                        if (v > insertAt) {
                            const nv = v + delta;
                            out.set(u32(Math.floor(nv / 0x100000000)), p);
                            out.set(u32(nv >>> 0), p + 4);
                        }
                    } else {
                        const v = bytesToU32(out, p);
                        if (v > insertAt) out.set(u32(v + delta), p);
                    }
                }
            }
        }

        return out.buffer;
    }

    /* -------------------------------- FLAC --------------------------------- */

    function buildVorbisCommentBlock(tags) {
        const vendor = utf8('Yandex Music Downloader');
        const comments = [];
        const push = (k, v) => {
            if (!v) return;
            const kv = concat([utf8(k), utf8('=' + v)]);
            comments.push(concat([u32(kv.length), kv]));
        };
        push('TITLE', tags.title);
        push('ARTIST', tags.artist);
        push('ALBUM', tags.album);
        push('DATE', tags.year);

        const listBody = concat([u32(vendor.length), vendor, u32(comments.length), ...comments]);
        return { block: concat([[0x04], u32(listBody.length), listBody]), type: 4 };
    }

    function buildPictureBlock(cover) {
        const mime = (cover.length > 8 && cover[0] === 0x89 && cover[1] === 0x50) ? 'image/png' : 'image/jpeg';
        const desc = utf8('');
        const body = concat([
            u32(3),
            u32(mime.length), utf8(mime),
            u32(desc.length), desc,
            u32(0), u32(0), u32(0), u32(0),
            u32(cover.length),
            cover
        ]);
        return { block: concat([[0x06], u32(body.length), body]), type: 6 };
    }

    function tagFlac(arrayBuffer, tags) {
        const src = new Uint8Array(arrayBuffer);
        if (src.length < 8 || src[0] !== 0x66 || src[1] !== 0x4C || src[2] !== 0x61 || src[3] !== 0x43) {
            throw new Error('FLAC: неверный заголовок');
        }

        const blocks = [];
        let off = 4;
        let sawLast = false;
        while (off < src.length) {
            const head = src[off];
            const isLast = !!(head & 0x80);
            const type = head & 0x7F;
            const len = (src[off + 1] << 16) | (src[off + 2] << 8) | src[off + 3];
            blocks.push({ type, body: src.slice(off + 4, off + 4 + len) });
            off += 4 + len;
            if (isLast) { sawLast = true; break; }
        }
        if (!sawLast) throw new Error('FLAC: повреждённые метаблоки');

        const kept = blocks.filter(b => b.type !== 0 && b.type !== 4 && b.type !== 6);
        const newBlocks = [
            buildVorbisCommentBlock(tags),
            ...(tags.cover ? [buildPictureBlock(tags.cover)] : [])
        ];

        const all = [
            ...kept.map(b => ({ raw: null, b })),
            ...newBlocks.map(nb => ({ raw: nb.block, b: null }))
        ];

        const parts = [src.slice(0, 4)];
        const total = all.length;
        all.forEach((item, idx) => {
            if (item.b) {
                const flag = (idx === total - 1 ? 0x80 : 0) | item.b.type;
                parts.push(concat([[flag], u32(item.b.body.length), item.b.body]));
            } else {
                const arr = new Uint8Array(item.raw);
                if (idx === total - 1) arr[0] |= 0x80;
                parts.push(arr);
            }
        });
        parts.push(src.slice(off));

        return concat(parts).buffer;
    }

    // Приводим обложку к Uint8Array (fetch отдаёт ArrayBuffer)
    function toBytes(v) {
        if (!v) return null;
        if (v instanceof Uint8Array) return v;
        if (v instanceof ArrayBuffer) return new Uint8Array(v);
        if (ArrayBuffer.isView(v)) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
        return null;
    }

    return {
        tagM4a,
        tagFlac,
        detectAndTag(arrayBuffer, container, tags) {
            const t = { ...tags, cover: toBytes(tags.cover) };
            if (container === 'm4a') return tagM4a(arrayBuffer, t);
            if (container === 'flac') return tagFlac(arrayBuffer, t);
            throw new Error('Тегирование для контейнера ' + container + ' не поддерживается');
        }
    };
})();

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
                coverUrl = `https://${trackInfo.coverUri.replace('%%', '1000x1000')}`;
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

        // Стремимся к lossless: если резолвился не FLAC — просим плеер запросить
        // «Превосходное» качество и берём лучший из доступных вариантов.
        if (!isLosslessInfo(downloadInfo)) {
            if (toastHandle) {
                toastHandle.update({ newStatus: 'Запрос максимального качества...', newProgress: 40 });
            }
            try {
                const upgraded = await upgradeQualityViaPlayer(trackId, albumId);
                if (upgraded && upgraded.url && qualityRank(upgraded) > qualityRank(downloadInfo)) {
                    downloadInfo = upgraded;
                }
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
                    if (coverBuffer) writer.addPictureFrame(coverBuffer instanceof ArrayBuffer ? coverBuffer : coverBuffer.buffer.slice(coverBuffer.byteOffset, coverBuffer.byteOffset + coverBuffer.byteLength), 'image/jpeg');
                    audioBuffer = writer.getTaggedBuffer();
                } else if (container === 'm4a' || container === 'flac') {
                    audioBuffer = YMTag.detectAndTag(audioBuffer, container, {
                        title, artist: artists, album, year: year ? String(year) : '', cover: coverBuffer
                    });
                }
            } catch (err) {
                console.error('Tagging error:', err);
                if (toastHandle) {
                    toastHandle.update({ newStatus: 'Теги не вшиты (' + (err.message || 'ошибка') + '), сохраняю файл...' });
                }
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
                newStatus: `Сохранено! ${qualityLabel} • теги и обложка ✓`,
                newProgress: 100,
                newState: 'success',
                dismissAfter: 8000
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
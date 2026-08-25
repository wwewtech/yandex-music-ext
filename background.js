/**
 * Yandex Music Downloader — Background Service Worker (Manifest V3)
 */

importScripts('md5.js');

const SALT = 'XGRlBW9FXlekgbPrRHuSiA';
const V2_HMAC_KEY = 'p93jhgh689SBReK6ghtw62';
const V2_CODECS = 'flac,flac-mp4,mp3,aac,he-aac,aac-mp4,he-aac-mp4';
const API_HEADERS = {
    'Accept': 'application/json, text/plain, */*',
    'X-Requested-With': 'XMLHttpRequest',
    'X-Yandex-Music-Client': 'YandexMusicWebNext/1.0.0',
    'Origin': 'https://music.yandex.ru',
    'Referer': 'https://music.yandex.ru/'
};

chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
        chrome.storage.local.set({
            embedTags: true,
            toasts: true,
            filenamePattern: 'artist-title',
            saveAs: false
        });
    }
});

function bytesToBase64(bytes) {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
}

async function makeV2Sign(ts, trackId, quality, variant = 'web') {
    const codecsNoSep = V2_CODECS.replace(/,/g, '');
    let msg;
    if (variant === 'marshal') {
        msg = `${trackId}${ts}`;
    } else if (variant === 'web-alt') {
        msg = `${trackId}${ts}${quality}${codecsNoSep}encraw`;
    } else {
        msg = `${ts}${trackId}${quality}${codecsNoSep}encraw`;
    }

    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
        'raw',
        enc.encode(V2_HMAC_KEY),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msg));
    const b64 = bytesToBase64(new Uint8Array(sig));
    return variant === 'marshal' ? b64 : b64.slice(0, -1);
}

async function decryptEncraw(data, hexKey) {
    if (!hexKey) return data;
    const keyBytes = new Uint8Array(hexKey.length / 2);
    for (let i = 0; i < keyBytes.length; i++) {
        keyBytes[i] = parseInt(hexKey.substr(i * 2, 2), 16);
    }
    const cryptoKey = await crypto.subtle.importKey(
        'raw', keyBytes, { name: 'AES-CTR' }, false, ['decrypt']
    );
    const counter = new Uint8Array(16);
    const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-CTR', counter, length: 128 },
        cryptoKey,
        data
    );
    return new Uint8Array(decrypted);
}

function detectContainer(bytes) {
    if (!bytes || bytes.length < 12) return 'unknown';
    if (bytes[0] === 0x66 && bytes[1] === 0x4c && bytes[2] === 0x61 && bytes[3] === 0x43) return 'flac';
    if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) return 'm4a';
    if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return 'mp3';
    if (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return 'mp3';
    return 'unknown';
}

function extForContainer(container, codec) {
    const c = String(codec || '').toLowerCase();
    if (container === 'flac' || c.includes('flac')) return 'flac';
    if (container === 'm4a' || c.includes('aac') || c.includes('mp4')) return 'm4a';
    if (container === 'mp3' || c.includes('mp3')) return 'mp3';
    return 'mp3';
}

async function getToken(request) {
    if (request && request.token) return String(request.token);
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

function authedHeaders(token) {
    // Authorization опционален: веб-клиент авторизуется cookie, токен — бонус
    // (открывает мобильные битрейты/FLAC в /download-info).
    const h = { ...API_HEADERS };
    if (token) h['Authorization'] = 'OAuth ' + token;
    return h;
}

/* ---- Offscreen document: единственное место в MV3 с URL.createObjectURL ---- */

async function ensureOffscreenDocument() {
    try {
        if (await chrome.offscreen.hasDocument()) return;
    } catch (_) {}
    try {
        await chrome.offscreen.createDocument({
            url: 'offscreen.html',
            reasons: ['BLOBS'],
            justification: 'Создание blob-ссылок для скачивания аудиофайлов'
        });
    } catch (e) {
        if (!/already exists|single/i.test(String(e && e.message))) throw e;
    }
}

function downloadViaOffscreen(payload) {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({ target: 'offscreen', action: 'download_blob', ...payload }, (resp) => {
            if (chrome.runtime.lastError) resolve({ error: chrome.runtime.lastError.message });
            else resolve(resp || {});
        });
    });
}

async function downloadBytesAsFile(bytesBase64, filename, mime, saveAs) {
    await ensureOffscreenDocument();
    return downloadViaOffscreen({ bytesBase64, filename, mime, saveAs });
}

async function fetchJson(url, useCredentials = true, extraHeaders = null) {
    const res = await fetch(url, {
        credentials: useCredentials ? 'include' : 'omit',
        headers: extraHeaders ? { ...API_HEADERS, ...extraHeaders } : API_HEADERS
    });
    const text = await res.text();
    if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 120)}`);
    }
    try {
        return JSON.parse(text);
    } catch (_) {
        throw new Error(`Ответ не JSON: ${text.slice(0, 120)}`);
    }
}

async function fetchText(url, useCredentials = true, extraHeaders = null) {
    const res = await fetch(url, {
        credentials: useCredentials ? 'include' : 'omit',
        headers: { ...API_HEADERS, ...(extraHeaders || {}), 'Accept': '*/*' }
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return text;
}

function parseDownloadInfo(payload) {
    if (!payload) return null;
    const info = payload.result?.downloadInfo || payload.downloadInfo || payload.result || payload;
    if (!info || typeof info !== 'object') return null;

    const url = info.url || (Array.isArray(info.urls) && info.urls[0]) || null;
    if (!url || typeof url !== 'string') return null;

    return {
        url: normalizeStreamUrl(url),
        key: info.key || info.decryptionKey || null,
        transport: info.transport || '',
        codec: info.codec || '',
        size: info.size || 0,
        bitrate: info.bitrate || info.bitrateInKbps || 0
    };
}

function normalizeStreamUrl(rawUrl) {
    try {
        const parsed = new URL(rawUrl);
        parsed.searchParams.delete('seg');
        parsed.searchParams.delete('bufSize');
        parsed.searchParams.delete('t');
        return parsed.toString();
    } catch (_) {
        return rawUrl;
    }
}

function buildGetMp3Url(xmlOrJson) {
    let host, path, ts, s;
    if (typeof xmlOrJson === 'object') {
        host = xmlOrJson.host;
        path = xmlOrJson.path;
        ts = xmlOrJson.ts;
        s = xmlOrJson.s;
    } else {
        host = xmlOrJson.match(/<host>(.*?)<\/host>/)?.[1];
        path = xmlOrJson.match(/<path>(.*?)<\/path>/)?.[1];
        ts = xmlOrJson.match(/<ts>(.*?)<\/ts>/)?.[1];
        s = xmlOrJson.match(/<s>(.*?)<\/s>/)?.[1];
    }
    if (!host || !path || ts == null || s == null || typeof md5 !== 'function') return null;
    const sign = md5(SALT + path.substring(1) + s);
    return `https://${host}/get-mp3/${sign}/${ts}${path}`;
}

function pickBestStream(items, preferMp3 = true) {
    if (!Array.isArray(items) || !items.length) return null;
    const norm = (v) => String(v || '').toLowerCase();

    if (preferMp3) {
        const mp3_320 = items.find(i => norm(i.codec) === 'mp3' && (i.bitrateInKbps === 320 || i.bitrate === 320));
        if (mp3_320) return mp3_320;
        const anyMp3 = items.find(i => norm(i.codec) === 'mp3');
        if (anyMp3) return anyMp3;
    }

    return items.sort((a, b) => (b.bitrateInKbps || b.bitrate || 0) - (a.bitrateInKbps || a.bitrate || 0))[0];
}

async function resolveViaGetFileInfo(trackId, quality, token) {
    const variants = ['web', 'marshal'];
    let lastError = null;

    for (const variant of variants) {
        try {
            const ts = Math.floor(Date.now() / 1000);
            const sign = await makeV2Sign(ts, trackId, quality, variant);
            const url = `https://api.music.yandex.ru/get-file-info?ts=${ts}&trackId=${encodeURIComponent(trackId)}` +
                `&quality=${encodeURIComponent(quality)}` +
                `&codecs=${encodeURIComponent(V2_CODECS)}` +
                `&transports=encraw&sign=${encodeURIComponent(sign)}`;

            const payload = await fetchJson(url, true, token ? { 'Authorization': 'OAuth ' + token } : null);
            const info = parseDownloadInfo(payload);
            if (info) return info;

            const errName = payload?.result?.name || payload?.name || '';
            lastError = new Error(errName || 'get-file-info: нет downloadInfo');
        } catch (err) {
            lastError = err;
        }
    }

    throw lastError || new Error('get-file-info failed');
}

/**
 * V1: /tracks/{id}/download-info с cookie-авторизацией (+ OAuth-токен, если
 * перехвачен) — отдаёт ПОЛНЫЙ трек (не preview) в виде чистого MP3 без шифрования.
 */
async function resolveViaDownloadInfoAuthed(trackId, token) {
    const endpoints = [
        `https://api.music.yandex.net/tracks/${encodeURIComponent(trackId)}/download-info`,
        `https://api.music.yandex.ru/tracks/${encodeURIComponent(trackId)}/download-info`
    ];

    for (const endpoint of endpoints) {
        try {
            // credentials include: авторизация cookie-сессией music.yandex.ru
            const payload = await fetchJson(endpoint, true, authedHeaders(token));
            const items = Array.isArray(payload) ? payload : (payload.result || []);

            // Защита от превью: если всё, что вернул API — preview, качать нельзя.
            const fullItems = items.filter((i) => i && i.preview !== true);
            if (fullItems.length === 0 && items.length > 0) {
                throw new Error('Трек доступен только как 30-секундное превью. Нужна подписка Плюс или повторный вход на music.yandex.ru');
            }

            const pick = pickBestStream(fullItems.length ? fullItems : items, true);
            if (!pick?.downloadInfoUrl) continue;

            const sep = pick.downloadInfoUrl.includes('?') ? '&' : '?';
            const infoText = await fetchText(pick.downloadInfoUrl + sep + 'format=json', true, authedHeaders(token));
            let parsed;
            try {
                parsed = JSON.parse(infoText);
            } catch (_) {
                parsed = infoText;
            }
            const mp3Url = buildGetMp3Url(parsed);
            if (!mp3Url) continue;

            return {
                url: mp3Url,
                key: null,
                transport: 'raw',
                codec: pick.codec || 'mp3',
                size: 0,
                bitrate: pick.bitrateInKbps || pick.bitrate || 320,
                preview: pick.preview === true
            };
        } catch (err) {
            if (err && /превью|Плюс/.test(err.message)) throw err;
        }
    }
    return null;
}

async function resolveViaSignedUrl(signedUrl) {
    const payload = await fetchJson(signedUrl, true);
    return parseDownloadInfo(payload);
}

async function fetchAudioBytes(url, key, expectedSize) {
    const res = await fetch(url, { credentials: 'omit' });
    if (!res.ok) throw new Error(`Загрузка аудио: HTTP ${res.status}`);

    let bytes = new Uint8Array(await res.arrayBuffer());
    if (key) {
        bytes = await decryptEncraw(bytes, key);
    }

    if (expectedSize > 0 && bytes.length < expectedSize * 0.5) {
        throw new Error(`Файл слишком короткий (${bytes.length} байт, ожидалось ~${expectedSize})`);
    }
    return bytes;
}

async function downloadProcessedAudio(opts) {
    const bytes = await fetchAudioBytes(opts.url, opts.key || null, opts.expectedSize || 0);
    const container = detectContainer(bytes);
    const ext = extForContainer(container, opts.codec);
    let filename = (opts.filename || 'track').replace(/[\\/:*?"<>|]/g, '_').trim();
    filename = filename.replace(/\.[^.]+$/, '') + '.' + ext;

    const result = await downloadBytesAsFile(bytesToBase64(bytes), filename, 'application/octet-stream', Boolean(opts.saveAs));
    if (result.error) return { error: result.error };
    return { ...result, size: bytes.length, container, ext };
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'download') {
        const safeFilename = (request.filename || 'track').replace(/[\\/:*?"<>|]/g, '_').trim();
        chrome.downloads.download({
            url: request.url,
            filename: `${safeFilename}.mp3`,
            saveAs: Boolean(request.saveAs)
        }, (downloadId) => {
            if (chrome.runtime.lastError) sendResponse({ error: chrome.runtime.lastError.message });
            else sendResponse({ downloadId });
        });
        return true;
    }

    if (request.action === 'fetch_json') {
        fetchJson(request.url, request.credentials !== false)
            .then(json => sendResponse({ json }))
            .catch(err => sendResponse({ error: err.message || String(err) }));
        return true;
    }

    if (request.action === 'fetch_text') {
        fetchText(request.url, request.credentials !== false)
            .then(text => sendResponse({ text }))
            .catch(err => sendResponse({ error: err.message || String(err) }));
        return true;
    }

    if (request.action === 'fetch_data_url') {
        fetch(request.url, { credentials: 'omit' })
            .then(res => {
                if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
                return res.blob();
            })
            .then(blob => {
                const reader = new FileReader();
                reader.onloadend = () => sendResponse({ dataUrl: reader.result });
                reader.onerror = () => sendResponse({ error: 'Blob conversion failed' });
                reader.readAsDataURL(blob);
            })
            .catch(err => sendResponse({ error: err.message || String(err) }));
        return true;
    }

    if (request.action === 'resolve_track_download') {
        (async () => {
            const trackId = String(request.trackId);
            const signedUrl = request.signedUrl || null;
            const token = await getToken(request);

            // 1. Подписанный URL, перехваченный из реального трафика страницы.
            if (signedUrl) {
                try {
                    const fromSigned = await resolveViaSignedUrl(signedUrl);
                    if (fromSigned) return fromSigned;
                } catch (_) {}
            }

            // 2. V1 download-info — авторизация через cookie сессии (токен опционален).
            //    Отдаёт полный MP3 без шифрования.
            const legacy = await resolveViaDownloadInfoAuthed(trackId, token);
            if (legacy) return legacy;

            // 3. V2 get-file-info с подписью (+ cookie/токен). encraw → AES-CTR расшифровка.
            for (const quality of ['nq', 'hq', 'lossless']) {
                try {
                    const info = await resolveViaGetFileInfo(trackId, quality, token);
                    if (info) return info;
                } catch (_) {}
            }

            throw new Error('Не удалось получить ссылку на трек. Убедитесь, что вы залогинены на music.yandex.ru и у вас есть подписка Плюс, затем обновите страницу (Ctrl+F5)');
        })()
            .then(info => sendResponse({ info }))
            .catch(err => sendResponse({ error: err.message || String(err) }));
        return true;
    }

    if (request.action === 'fetch_track_bytes') {
        fetchAudioBytes(request.url, request.key || null, request.expectedSize || 0)
            .then(bytes => {
                const container = detectContainer(bytes);
                sendResponse({
                    bytes: bytesToBase64(bytes),
                    size: bytes.length,
                    container,
                    ext: extForContainer(container, request.codec)
                });
            })
            .catch(err => sendResponse({ error: err.message || String(err) }));
        return true;
    }

    if (request.action === 'download_bytes') {
        downloadBytesAsFile(request.bytesBase64, request.filename, request.mime, Boolean(request.saveAs))
            .then(result => sendResponse(result))
            .catch(err => sendResponse({ error: err.message || String(err) }));
        return true;
    }

    if (request.action === 'download_track_audio') {
        downloadProcessedAudio(request)
            .then(result => sendResponse(result))
            .catch(err => sendResponse({ error: err.message || String(err) }));
        return true;
    }
});

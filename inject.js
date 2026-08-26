(function () {
    'use strict';

    const cache = {};
    window.__ymExtFileInfoCache = cache;

    /* ---- OAuth token capture from real page requests ------------------ */
    const API_HOSTS = ['api.music.yandex.ru', 'api.music.yandex.net'];
    let lastReportedToken = '';

    function extractFromAuthValue(v) {
        if (typeof v !== 'string') return '';
        const m = v.match(/(?:OAuth|Bearer)\s+([A-Za-z0-9_.\-]+)/i);
        return m ? m[1].trim() : '';
    }

    function extractFromHeaders(headers) {
        try {
            if (!headers) return '';
            if (headers instanceof Headers) {
                return extractFromAuthValue(headers.get('Authorization') || '');
            }
            if (Array.isArray(headers)) {
                for (const pair of headers) {
                    if (Array.isArray(pair) && pair[0] && String(pair[0]).toLowerCase() === 'authorization') {
                        return extractFromAuthValue(pair[1]);
                    }
                }
                return '';
            }
            if (typeof headers === 'object') {
                for (const k in headers) {
                    if (k.toLowerCase() === 'authorization') return extractFromAuthValue(headers[k]);
                }
            }
        } catch (_) {}
        return '';
    }

    function isApiUrl(url) {
        if (typeof url !== 'string') return false;
        return API_HOSTS.some((h) => url.indexOf(h) !== -1);
    }

    function reportToken(token, source) {
        if (!token || typeof token !== 'string' || token.length < 20) return;
        if (token === lastReportedToken) return;
        lastReportedToken = token;
        try {
            document.dispatchEvent(new CustomEvent('ym-ext-token', {
                detail: { token, source }
            }));
        } catch (_) {}
    }

    // Приоритет качества: lossless > mp4-lossless > mp3 > aac > he-aac; затем битрейт
    function qualityScore(info) {
        if (!info) return -1;
        const codec = String(info.codec || '').toLowerCase();
        let base = 0;
        if (codec === 'flac') base = 5000;
        else if (codec.includes('flac')) base = 4000;
        else if (codec.includes('mp3')) base = 3000;
        else if (codec.includes('he-aac')) base = 1000;
        else base = 2000; // aac / aac-mp4
        return base + (Number(info.bitrate || info.bitrateInKbps || 0) / 10);
    }

    function remember(trackId, info) {
        if (!trackId || !info) return;
        const existing = cache[String(trackId)];
        if (existing && existing.info && qualityScore(existing.info) > qualityScore(info)) {
            // Уже есть вариант лучше — не затираем его худшим
            existing.ts = Date.now();
            return;
        }
        cache[String(trackId)] = {
            info,
            ts: Date.now()
        };
        try {
            document.dispatchEvent(new CustomEvent('ym-ext-file-info', {
                detail: { trackId: String(trackId), info }
            }));
        } catch (_) {}
    }

    function extractTrackId(url) {
        try {
            const parsed = new URL(url);
            return parsed.searchParams.get('trackId') ||
                (parsed.searchParams.get('trackIds') || '').split(',')[0] ||
                null;
        } catch (_) {
            return null;
        }
    }

    // Рекурсивный поиск объекта с прямой ссылкой на аудио — устойчив к разным
    // схемам ответов get-file-info и get-file-info/batch.
    function findDownloadInfo(obj, depth) {
        if (!obj || typeof obj !== 'object' || depth > 4) return null;
        if (typeof obj.url === 'string' && obj.url.startsWith('http')) return obj;
        for (const k of Object.keys(obj)) {
            const found = findDownloadInfo(obj[k], depth + 1);
            if (found) return found;
        }
        return null;
    }

    function parsePayload(payload) {
        const info = findDownloadInfo(payload, 0);
        if (!info) return null;
        return {
            url: info.url,
            key: info.key || info.decryptionKey || null,
            transport: info.transport || '',
            codec: info.codec || '',
            size: info.size || 0,
            bitrate: info.bitrate || info.bitrateInKbps || 0
        };
    }

    /* ---- Индекс метаданных треков (title -> ids) ---------------------- */
    // Собираем из ЛЮБЫХ API-ответов объекты вида {id, title, albums:[{id}]}.
    // Нужен для поверхностей без ссылок на треки («Моя волна», очереди).
    function normTitle(t) {
        return String(t || '')
            .toLowerCase()
            .replace(/[\s\u00a0]+/g, ' ')
            .replace(/[^\p{L}\p{N} ]/gu, '')
            .trim();
    }

    const reportedMetaKeys = new Set();

    function collectTrackMetas(obj, depth, out) {
        if (!obj || typeof obj !== 'object' || depth > 6) return;
        if (Array.isArray(obj)) {
            for (const item of obj) collectTrackMetas(item, depth + 1, out);
            return;
        }
        const id = obj.id != null ? String(obj.id) : null;
        const title = typeof obj.title === 'string' ? obj.title : '';
        if (id && title && Array.isArray(obj.albums) && obj.albums[0] && obj.albums[0].id != null) {
            out.push({ trackId: id, albumId: String(obj.albums[0].id), title });
            return; // внутрь конкретного трека не углубляемся
        }
        for (const k of Object.keys(obj)) {
            try { collectTrackMetas(obj[k], depth + 1, out); } catch (_) {}
        }
    }

    async function harvestTrackMetas(url, response) {
        if (!isApiUrl(url) || url.includes('get-file-info')) return;
        try {
            const clone = response.clone();
            const payload = await clone.json();
            const found = [];
            collectTrackMetas(payload, 0, found);
            for (const meta of found) {
                const key = normTitle(meta.title) + '|' + meta.trackId;
                if (reportedMetaKeys.has(key)) continue;
                reportedMetaKeys.add(key);
                try {
                    document.dispatchEvent(new CustomEvent('ym-ext-track-meta', { detail: meta }));
                } catch (_) {}
            }
        } catch (_) {}
    }

    async function handleResponse(url, response) {
        if (!url.includes('api.music.yandex.ru/get-file-info') &&
            !url.includes('api.music.yandex.net/get-file-info')) {
            harvestTrackMetas(url, response);
            return;
        }
        const trackId = extractTrackId(url);
        if (!trackId) return;

        try {
            const clone = response.clone();
            const payload = await clone.json();
            const info = parsePayload(payload);
            if (info) remember(trackId, info);
        } catch (_) {}
    }

    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
        try {
            let url = '';
            let requestHeaders = null;
            if (typeof args[0] === 'string') url = args[0];
            else if (args[0] && args[0].url) { url = args[0].url; requestHeaders = args[0].headers; }
            if (isApiUrl(url)) {
                const t = extractFromHeaders((args[1] && args[1].headers) || requestHeaders);
                if (t) reportToken(t, 'fetch');
            }
        } catch (_) {}
        const response = await originalFetch.apply(this, args);
        try {
            const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
            if (url) handleResponse(url, response);
        } catch (_) {}
        return response;
    };

    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;
    const originalSetHeader = XMLHttpRequest.prototype.setRequestHeader;

    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        this.__ymExtUrl = url;
        return originalOpen.call(this, method, url, ...rest);
    };

    XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
        try {
            if (typeof name === 'string' && name.toLowerCase() === 'authorization' &&
                isApiUrl(this.__ymExtUrl)) {
                const t = extractFromAuthValue(value);
                if (t) reportToken(t, 'xhr');
            }
        } catch (_) {}
        return originalSetHeader.call(this, name, value);
    };

    /* ---- Тихое сохранение файла -------------------------------------- */
    // Скачивание инициируется самой страницей (<a download>), поэтому Chrome
    // НЕ показывает системное уведомление «Загрузка завершена», которое
    // появляется при скачивании через chrome.downloads API расширения.
    window.addEventListener('message', (event) => {
        if (event.source !== window) return;
        const msg = event.data;
        if (!msg || msg.type !== 'ym-ext-save-file') return;
        let ack;
        try {
            const bin = atob(msg.bytesBase64);
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            const blob = new Blob([bytes], { type: msg.mime || 'application/octet-stream' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = msg.filename || 'track.mp3';
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 60000);
            ack = { type: 'ym-ext-saved', ok: true, filename: msg.filename };
        } catch (e) {
            ack = { type: 'ym-ext-saved', ok: false, error: String((e && e.message) || e) };
        }
        window.postMessage(ack, '*');
    });

    XMLHttpRequest.prototype.send = function (...args) {
        this.addEventListener('load', function () {
            try {
                if (!this.__ymExtUrl || this.status < 200 || this.status >= 300) return;
                const payload = JSON.parse(this.responseText);
                const trackId = extractTrackId(this.__ymExtUrl);
                const info = parsePayload(payload);
                if (trackId && info) remember(trackId, info);
                else harvestTrackMetas(this.__ymExtUrl, { clone: () => ({ json: () => payload }) });
            } catch (_) {}
        });
        return originalSend.apply(this, args);
    };
})();

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

    function remember(trackId, info) {
        if (!trackId || !info) return;
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

    function parsePayload(payload) {
        const info = payload?.result?.downloadInfo || payload?.downloadInfo;
        if (!info || !info.url) return null;
        return {
            url: info.url,
            key: info.key || null,
            transport: info.transport || '',
            codec: info.codec || '',
            size: info.size || 0,
            bitrate: info.bitrate || 0
        };
    }

    async function handleResponse(url, response) {
        if (!url.includes('api.music.yandex.ru/get-file-info') &&
            !url.includes('api.music.yandex.net/get-file-info')) {
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

    XMLHttpRequest.prototype.send = function (...args) {
        this.addEventListener('load', function () {
            try {
                if (!this.__ymExtUrl || this.status < 200 || this.status >= 300) return;
                const payload = JSON.parse(this.responseText);
                const trackId = extractTrackId(this.__ymExtUrl);
                const info = parsePayload(payload);
                if (trackId && info) remember(trackId, info);
            } catch (_) {}
        });
        return originalSend.apply(this, args);
    };
})();

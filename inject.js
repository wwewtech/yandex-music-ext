(function () {
    'use strict';

    const cache = {};
    window.__ymExtFileInfoCache = cache;

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
        const response = await originalFetch.apply(this, args);
        try {
            const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
            if (url) handleResponse(url, response);
        } catch (_) {}
        return response;
    };

    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        this.__ymExtUrl = url;
        return originalOpen.call(this, method, url, ...rest);
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

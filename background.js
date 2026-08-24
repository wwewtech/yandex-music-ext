/**
 * Yandex Music Downloader — Background Service Worker (Manifest V3)
 *
 * Strategy (2025): The old music.yandex.ru/api/v2.1/handlers/track/.../download/m endpoint
 * is dead (HTTP 404). Yandex now uses api.music.yandex.ru/get-file-info with a server-signed
 * HMAC token. We cannot compute that token ourselves.
 *
 * Solution: intercept the browser's own get-file-info response (already contains the signed
 * stream URL) and cache it keyed by trackId. When content.js asks for a download, we return
 * the cached URL directly - no signing needed, no extra API calls.
 */

// ── Stream URL cache ─────────────────────────────────────────────────────────
// Map: trackId (string) → { url: string, ts: number }
const streamCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ── Settings init ────────────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
        chrome.storage.local.set({
            embedTags: true,
            toasts: true,
            filenamePattern: 'artist-title',
            saveAs: false
        });
        console.log('[YMD] Initialized default extension preferences');
    }
});

// ── Intercept get-file-info responses ────────────────────────────────────────
// When Yandex player fetches file info, we read the response body to extract stream URL.
chrome.webRequest.onCompleted.addListener(
    (details) => {
        // Only intercept get-file-info calls from music tabs
        if (!details.url.includes('get-file-info')) return;

        // Extract trackId from URL params
        const urlObj = new URL(details.url);
        const trackId = urlObj.searchParams.get('trackId') || urlObj.searchParams.get('trackIds');
        if (!trackId) return;

        // We can't read response body from webRequest in MV3 without a filter.
        // Use a filter to read the response stream.
        const filter = chrome.webRequest.filterResponseData(details.requestId);
        const decoder = new TextDecoder('utf-8');
        let chunks = [];

        filter.ondata = (event) => {
            chunks.push(event.data);
            filter.write(event.data); // pass through unchanged
        };

        filter.onstop = () => {
            filter.disconnect();
            const body = decoder.decode(concatBuffers(chunks));
            try {
                const data = JSON.parse(body);
                // Response can be array (batch) or object (single)
                const items = Array.isArray(data) ? data : [data];
                for (const item of items) {
                    const tid = String(item.trackId || item.id || trackId.split(',')[0]);
                    // Find the best downloadable URL (mp3 > aac > any)
                    const streamUrl = extractBestUrl(item);
                    if (streamUrl) {
                        streamCache.set(tid, { url: streamUrl, ts: Date.now() });
                        console.log(`[YMD] Cached stream URL for track ${tid}`);
                    }
                }
            } catch (e) {
                console.warn('[YMD] Failed to parse get-file-info response:', e);
            }
        };
    },
    {
        urls: [
            '*://api.music.yandex.ru/get-file-info*',
            '*://api.music.yandex.ru/get-file-info/batch*'
        ],
        types: ['xmlhttprequest', 'other']
    },
    ['blocking']
);

function concatBuffers(buffers) {
    const total = buffers.reduce((sum, b) => sum + b.byteLength, 0);
    const result = new Uint8Array(total);
    let offset = 0;
    for (const b of buffers) {
        result.set(new Uint8Array(b), offset);
        offset += b.byteLength;
    }
    return result.buffer;
}

function extractBestUrl(item) {
    // Try direct stream field names used by Yandex
    if (item.url) return item.url;
    if (item.src) return item.src;

    // Try downloadInfo array structure
    const info = item.downloadInfo || item.urls || item.sources;
    if (Array.isArray(info) && info.length > 0) {
        // Sort: prefer mp3/high quality
        const sorted = [...info].sort((a, b) => {
            const qualityScore = (x) => {
                const u = (x.url || x.src || '').toLowerCase();
                if (u.includes('mp3')) return 3;
                if (u.includes('flac')) return 4;
                if (u.includes('aac192')) return 2;
                if (u.includes('aac')) return 1;
                return 0;
            };
            return qualityScore(b) - qualityScore(a);
        });
        const best = sorted[0];
        return best.url || best.src || null;
    }

    return null;
}

// ── Message handler ───────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

    // ── Get cached stream URL for a track ──────────────────────────────────
    if (request.action === 'get_cached_stream') {
        const trackId = String(request.trackId);
        const cached = streamCache.get(trackId);
        if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
            sendResponse({ url: cached.url });
        } else {
            sendResponse({ url: null });
        }
        return false;
    }

    // ── Download a file via chrome.downloads ───────────────────────────────
    if (request.action === 'download') {
        const safeFilename = request.filename
            ? request.filename.replace(/[\\/:*?"<>|]/g, '_').trim()
            : 'track';
        chrome.downloads.download({
            url: request.url,
            filename: `${safeFilename}.mp3`,
            saveAs: Boolean(request.saveAs)
        }, (downloadId) => {
            if (chrome.runtime.lastError) {
                sendResponse({ error: chrome.runtime.lastError.message });
            } else {
                sendResponse({ downloadId });
            }
        });
        return true;
    }

    // ── Fetch binary data as data URL (CORS proxy) ─────────────────────────
    if (request.action === 'fetch_data_url') {
        fetch(request.url, { credentials: 'include' })
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
});
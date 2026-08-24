/**
 * Yandex Music Downloader — Background Service Worker (Manifest V3)
 * Handles CORS proxying, downloads management, and lifecycle events.
 */

chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
        // Initialize default storage settings
        chrome.storage.local.set({
            embedTags: true,
            toasts: true,
            filenamePattern: 'artist-title',
            saveAs: false
        });
        console.log('[YMD] Initialized default extension preferences');
    }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'download') {
        const safeFilename = request.filename ? request.filename.replace(/[\\/:*?"<>|]/g, "_").trim() : 'track';
        const saveAs = Boolean(request.saveAs);

        chrome.downloads.download({
            url: request.url,
            filename: `${safeFilename}.mp3`,
            saveAs: saveAs
        }, (downloadId) => {
            if (chrome.runtime.lastError) {
                console.error('[YMD] Download error:', chrome.runtime.lastError.message);
                sendResponse({ error: chrome.runtime.lastError.message });
            } else {
                sendResponse({ downloadId });
            }
        });
        return true;
    } 
    
    if (request.action === 'fetch_data_url') {
        // Proxy binary data via background worker to bypass CORS in content scripts
        fetch(request.url)
            .then(res => {
                if (!res.ok) throw new Error(`HTTP error ${res.status}: ${res.statusText}`);
                return res.blob();
            })
            .then(blob => {
                const reader = new FileReader();
                reader.onloadend = () => {
                    sendResponse({ dataUrl: reader.result });
                };
                reader.onerror = () => {
                    sendResponse({ error: 'Failed to convert blob to dataUrl' });
                };
                reader.readAsDataURL(blob);
            })
            .catch(err => {
                sendResponse({ error: err.message || err.toString() });
            });
        
        return true; // Async response
    }
});
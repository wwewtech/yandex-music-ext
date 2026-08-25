/**
 * Yandex Music Downloader — Offscreen Document (Manifest V3)
 *
 * В MV3 URL.createObjectURL недоступен ни в content scripts, ни в service
 * worker. Offscreen-документ — единственное окружение расширения, где можно
 * создать Blob и blob-ссылку для chrome.downloads.download.
 */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.target !== 'offscreen' || msg.action !== 'download_blob') return;

    (async () => {
        try {
            const binary = atob(msg.bytesBase64 || '');
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

            const blob = new Blob([bytes], { type: msg.mime || 'application/octet-stream' });
            const blobUrl = URL.createObjectURL(blob);

            const safeFilename = String(msg.filename || 'track.mp3').replace(/[\\/:*?"<>|]/g, '_').trim();

            chrome.downloads.download({
                url: blobUrl,
                filename: safeFilename,
                saveAs: Boolean(msg.saveAs)
            }, (downloadId) => {
                setTimeout(() => URL.revokeObjectURL(blobUrl), 120000);
                if (chrome.runtime.lastError) {
                    sendResponse({ error: chrome.runtime.lastError.message });
                } else {
                    sendResponse({ downloadId, filename: safeFilename });
                }
            });
        } catch (e) {
            sendResponse({ error: e.message || String(e) });
        }
    })();

    return true; // async sendResponse
});
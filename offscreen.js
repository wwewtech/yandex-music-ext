/**
 * Yandex Music Downloader — Offscreen Document (Manifest V3)
 *
 * В MV3 URL.createObjectURL недоступен ни в content scripts, ни в service
 * worker. Offscreen-документ создаёт Blob и blob-ссылку.
 *
 * ВАЖНО: chrome.downloads в offscreen-документе НЕДОСТУПЕН, поэтому саму
 * загрузку выполняет background.js по возвращённой blob-ссылке (тот же
 * extension-origin, ссылка жива, пока мы её не отозвали).
 */

const heldBlobUrls = new Set();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.target !== 'offscreen') return;

    if (msg.action === 'make_blob_url') {
        try {
            const binary = atob(msg.bytesBase64 || '');
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

            const blob = new Blob([bytes], { type: msg.mime || 'application/octet-stream' });
            const blobUrl = URL.createObjectURL(blob);
            heldBlobUrls.add(blobUrl);
            sendResponse({ blobUrl });
        } catch (e) {
            sendResponse({ error: e.message || String(e) });
        }
        return;
    }

    if (msg.action === 'revoke_blob_url') {
        if (msg.blobUrl && heldBlobUrls.has(msg.blobUrl)) {
            URL.revokeObjectURL(msg.blobUrl);
            heldBlobUrls.delete(msg.blobUrl);
        }
        sendResponse({ ok: true });
        return;
    }
});
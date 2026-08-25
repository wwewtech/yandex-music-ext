/**
 * Trigger playback of a track, wait, then collect ALL get-file-info URLs
 * the real player requested (they contain the true sign format).
 */
const clicked = { tried: [], ok: false };

function q(sel) { return document.querySelector(sel); }

// Try several selectors for a playable row/button
const candidates = [
    'button[data-test-id="PLAY_BUTTON"]',
    '[class*="PlayButton"] button',
    'div[class*="Playlist"] button[class*="Play"]',
    'button[aria-label*="Слушать"]',
    'button[aria-label*="Play"]'
];
for (const sel of candidates) {
    const el = q(sel);
    clicked.tried.push(sel + (el ? ' [FOUND]' : ''));
    if (el) {
        el.click();
        clicked.ok = true;
        break;
    }
}

// Wait for the player to issue get-file-info
const deadline = Date.now() + 15000;
let urls = [];
while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 1000));
    urls = performance.getEntriesByType('resource')
        .map(e => e.name)
        .filter(u => u.includes('get-file-info'));
    if (urls.length) break;
}

return {
    clicked,
    getFileInfoUrls: urls.slice(-5),
    alsoBatch: performance.getEntriesByType('resource').map(e => e.name).filter(u => u.includes('batch')).slice(-3)
};
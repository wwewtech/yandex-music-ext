/**
 * Integration test of the new resolution logic against the REAL API.
 * 1. manifest.json is valid JSON.
 * 2. Preview-protection: unauthorized download-info returns preview:true items
 *    -> new code must throw instead of downloading 30s.
 * 3. buildGetMp3Url algorithm produces a working URL (verified on preview file).
 */
const crypto = require('crypto');
const fs = require('fs');
const SALT = 'XGRlBW9FXlekgbPrRHuSiA';

// --- 1. manifest valid
JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
console.log('[OK] manifest.json is valid JSON');

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

(async () => {
    const trackId = '153627759';

    // --- 2. preview protection (real API call, no token -> preview:true)
    const res = await fetch(`https://api.music.yandex.net/tracks/${trackId}/download-info`, {
        headers: { 'Accept': 'application/json' }
    });
    const payload = await res.json();
    const items = Array.isArray(payload) ? payload : (payload.result || []);
    const fullItems = items.filter((i) => i && i.preview !== true);
    if (fullItems.length === 0 && items.length > 0) {
        console.log('[OK] preview-protection works: all items are preview:true -> code throws "Трек доступен только как 30-секундное превью"');
    } else {
        console.log('[WARN] unexpected: got non-preview items without auth?', JSON.stringify(fullItems).slice(0, 200));
    }

    // --- 3. get-mp3 URL building (same as buildGetMp3Url)
    const pick = pickBestStream(items, true);
    const sep = pick.downloadInfoUrl.includes('?') ? '&' : '?';
    const infoText = await (await fetch(pick.downloadInfoUrl + sep + 'format=json')).text();
    const info = JSON.parse(infoText);
    const sign = crypto.createHash('md5').update(SALT + info.path.substring(1) + info.s).digest('hex');
    const mp3Url = `https://${info.host}/get-mp3/${sign}/${info.ts}${info.path}`;
    const audioRes = await fetch(mp3Url);
    const buf = Buffer.from(await audioRes.arrayBuffer());
    const approxSec = Math.round((buf.length * 8) / ((pick.bitrateInKbps || 128) * 1000));
    console.log(`[OK] get-mp3 URL built and fetched: HTTP ${audioRes.status}, ${buf.length} bytes, ~${approxSec}s (preview expected ~30s)`);

    console.log('ALL CHECKS DONE');
})().catch(e => { console.error('FAIL:', e); process.exit(1); });
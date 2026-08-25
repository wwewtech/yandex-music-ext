/**
 * Page-context E2E pipeline test (executed via cdp_eval.js on music.yandex.ru).
 * Returns a JSON report of every stage with your real session cookies.
 */
// --- 0. login status
const out = { steps: {} };
try {
    const accRes = await fetch('https://api.music.yandex.ru/account/status', { credentials: 'include' });
    const acc = await accRes.json();
    out.steps.login = {
        http: accRes.status,
        account: acc?.result?.account?.uid ? 'LOGGED_IN' : 'NOT_LOGGED_IN',
        plus: acc?.result?.permissions?.hasPlusForProduct ?? acc?.result?.plus?.hasPlus ?? null,
        login: acc?.result?.account?.login || null
    };
} catch (e) {
    out.steps.login = { error: e.message };
}

const TRACK_ID = '153627759';
const KEY = 'p93jhgh689SBReK6ghtw62';
const CODECS = 'flac,flac-mp4,mp3,aac,he-aac,aac-mp4,he-aac-mp4';

// --- 1. download-info with session cookies
try {
    const diRes = await fetch(`https://api.music.yandex.net/tracks/${TRACK_ID}/download-info`, {
        credentials: 'include', headers: { 'Accept': 'application/json' }
    });
    const di = await diRes.json();
    const items = di.result || [];
    out.steps.downloadInfo = {
        http: diRes.status,
        variants: items.map(i => ({ codec: i.codec, kbps: i.bitrateInKbps, preview: i.preview }))
    };
} catch (e) {
    out.steps.downloadInfo = { error: e.message };
}

// --- 2. get-file-info with HMAC sign + cookies
let gfiInfo = null;
try {
    const ts = Math.floor(Date.now() / 1000);
    const enc = new TextEncoder();
    const hmacKey = await crypto.subtle.importKey('raw', enc.encode(KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sigBuf = await crypto.subtle.sign('HMAC', hmacKey, enc.encode(`${ts}${TRACK_ID}nq${CODECS.replace(/,/g, '')}encraw`));
    let sign = btoa(String.fromCharCode(...new Uint8Array(sigBuf)));
    sign = sign.slice(0, -1);

    const gfiRes = await fetch(`https://api.music.yandex.ru/get-file-info?ts=${ts}&trackId=${TRACK_ID}&quality=nq&codecs=${encodeURIComponent(CODECS)}&transports=encraw&sign=${encodeURIComponent(sign)}`, {
        credentials: 'include', headers: { 'Accept': 'application/json' }
    });
    const gfiText = await gfiRes.text();
    let gfi;
    try { gfi = JSON.parse(gfiText); } catch (_) { gfi = gfiText.slice(0, 200); }
    const info = gfi?.result?.downloadInfo || gfi?.downloadInfo || gfi?.result;
    const url = info?.url || (Array.isArray(info?.urls) && info.urls[0]) || null;
    gfiInfo = { url, key: info?.key || null, codec: info?.codec || null, bitrate: info?.bitrate || info?.bitrateInKbps || null };
    out.steps.getFileInfo = { http: gfiRes.status, ...gfiInfo, raw: url ? undefined : String(gfiText).slice(0, 300) };
} catch (e) {
    out.steps.getFileInfo = { error: e.message };
}

// --- 3. download + decrypt + container check
if (gfiInfo && gfiInfo.url) {
    try {
        const audioRes = await fetch(gfiInfo.url);
        let bytes = new Uint8Array(await audioRes.arrayBuffer());
        const downloadedBytes = bytes.length;

        if (gfiInfo.key) {
            const kb = new Uint8Array(gfiInfo.key.length / 2);
            for (let i = 0; i < kb.length; i++) kb[i] = parseInt(gfiInfo.key.substr(i * 2, 2), 16);
            const aesKey = await crypto.subtle.importKey('raw', kb, { name: 'AES-CTR' }, false, ['decrypt']);
            bytes = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-CTR', counter: new Uint8Array(16), length: 128 }, aesKey, bytes));
        }

        let kind = 'unknown';
        if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) kind = 'mp3';
        else if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) kind = 'm4a';
        else if (String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) === 'fLaC') kind = 'flac';

        // rough duration estimate for AAC ~192kbps / MP3 ~320kbps
        const kbps = gfiInfo.bitrate || 192;
        const approxSec = Math.round((bytes.length * 8) / (kbps * 1000));

        out.steps.audio = {
            http: audioRes.status,
            downloadedBytes,
            decryptedBytes: bytes.length,
            container: kind,
            approxSeconds: approxSec,
            verdict: kind !== 'unknown' && approxSec > 60 ? 'FULL_TRACK_OK' : (approxSec <= 40 ? 'PREVIEW_ONLY' : 'UNKNOWN')
        };
    } catch (e) {
        out.steps.audio = { error: e.message };
    }
} else {
    out.steps.audio = { skipped: 'нет ссылки из get-file-info' };
}

out.verdict = out.steps.audio?.verdict || 'INCOMPLETE';
return out;

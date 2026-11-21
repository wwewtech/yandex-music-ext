/**
 * Automated test: runs the REAL background.js in a sandbox with stubbed
 * chrome.* APIs and exercises its actual message-handling code paths.
 *
 * Run: node scripts/test_background_harness.js
 *
 * NOTE: this runs WITHOUT Yandex Music cookies, so the server legitimately
 * returns only previews. The test asserts the extension reacts correctly
 * (clear preview error, no silent 30s download).
 */
const fs = require('fs');
const vm = require('vm');
const nodeCrypto = require('crypto');

const V2_HMAC_KEY = 'p93jhgh689SBReK6ghtw62';
const V2_CODECS = 'flac,flac-mp4,mp3,aac,he-aac,aac-mp4,he-aac-mp4';

function assert(cond, msg) {
    if (!cond) { console.error('[FAIL]', msg); process.exit(1); }
    console.log('[OK]', msg);
}

(async () => {
    // ---- build sandbox -------------------------------------------------
    const md5Src = fs.readFileSync('md5.js', 'utf8');
    const bgSrc = fs.readFileSync('background.js', 'utf8');

    let messageHandler = null;
    const sandbox = {
        console,
        setTimeout,
        clearTimeout,
        importScripts: () => {}, // md5.js already evaluated into the context manually
        fetch: global.fetch,
        Response: global.Response,
        URLSearchParams: global.URLSearchParams,
        URL,
        TextEncoder,
        crypto: { subtle: nodeCrypto.webcrypto.subtle, getRandomValues: nodeCrypto.webcrypto.getRandomValues.bind(nodeCrypto.webcrypto) },
        btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
        atob: (s) => Buffer.from(s, 'base64').toString('binary'),
        performance: { now: () => Date.now() },
        chrome: {
            runtime: {
                onInstalled: { addListener() {} },
                onMessage: { addListener(fn) { messageHandler = fn; } },
                sendMessage: () => {},
                getManifest: () => ({ version: '0.0.0-test' }),
                lastError: null
            },
            alarms: {
                onAlarm: { addListener() {} },
                clearAll(cb) { if (cb) cb(); },
                create() {}
            },
            storage: {
                local: {
                    get(keys, cb) { cb({}); },
                    set(obj, cb) { if (cb) cb(); },
                    remove(key, cb) { if (cb) cb(); }
                }
            },
            // Пусто = браузер без логина: обмен sessionid должен сдаться и
            // цепочка обязана идти дальше по cookie-стратегиям.
            cookies: { getAll: async () => [] },
            downloads: { download(opts, cb) { cb(1); } },
            offscreen: {
                hasDocument: async () => true,
                createDocument: async () => {}
            }
        }
    };
    const ctx = vm.createContext(sandbox);
    vm.runInContext(md5Src, ctx, { filename: 'md5.js' });
    vm.runInContext(bgSrc, ctx, { filename: 'background.js' });

    assert(typeof messageHandler === 'function', 'background.js registered its onMessage handler');

    function send(msg) {
        return new Promise((resolve) => {
            const ret = messageHandler(msg, {}, (resp) => resolve(resp || {}));
            if (ret !== true) resolve({});
        });
    }

    // ---- test 1: md5 available inside background context ---------------
    const md5val = vm.runInContext(`md5('test')`, ctx);
    assert(md5val === '098f6bcd4621d373cade4e832627b4f6', 'md5() works inside background context');

    // ---- test 2: V2 sign matches independent reference implementation --
    const ts = 1787607200;
    const codecsNoSep = V2_CODECS.replace(/,/g, '');
    const msgWeb = `${ts}153627759nq${codecsNoSep}encraw`;
    const expectedWeb = nodeCrypto.createHmac('sha256', V2_HMAC_KEY).update(msgWeb).digest('base64').slice(0, -1);
    const gotWeb = await vm.runInContext(`makeV2Sign(${ts}, '153627759', 'nq', 'web')`, ctx);
    assert(gotWeb === expectedWeb, `makeV2Sign web variant matches reference (${gotWeb.slice(0, 12)}...)`);

    const msgMarshal = `153627759${ts}`;
    const expectedMarshal = nodeCrypto.createHmac('sha256', V2_HMAC_KEY).update(msgMarshal).digest('base64');
    const gotMarshal = await vm.runInContext(`makeV2Sign(${ts}, '153627759', 'nq', 'marshal')`, ctx);
    assert(gotMarshal === expectedMarshal, 'makeV2Sign marshal variant matches reference (keeps padding)');

    // ---- test 3: container detection (arrays padded to >=12 bytes) -----
    const detect = (hex) => vm.runInContext(`detectContainer(new Uint8Array([${hex}]))`, ctx);
    const pad = '0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00';
    assert(detect('0x49,0x44,0x33,0x04,0x00,' + pad) === 'mp3', 'detectContainer: ID3 -> mp3');
    assert(detect('0x00,0x00,0x00,0x20,0x66,0x74,0x79,0x70,' + pad) === 'm4a', 'detectContainer: ftyp -> m4a');
    assert(detect('0x66,0x4c,0x61,0x43,' + pad) === 'flac', 'detectContainer: fLaC -> flac');

    // ---- test 4: real network path — anonymous request must be blocked
    //      by preview protection, NOT silently downloaded as 30s file.
    //      ALSO: preview-only must NOT abort the chain — get-file-info
    //      must still be attempted afterwards. ---------------------------------
    let gfiAttempts = 0;
    const realFetch = sandbox.fetch;
    sandbox.fetch = (url, init) => {
        if (String(url).includes('get-file-info')) gfiAttempts++;
        return realFetch(url, init);
    };

    const resp = await send({ action: 'resolve_track_download', trackId: '153627759', token: '' });
    assert(typeof resp.error === 'string' && resp.error.length > 0,
        'anonymous resolve returns an error (no silent fallback)');
    assert(/превью|Плюс|залогинены/i.test(resp.error),
        `error is actionable for the user: "${resp.error}"`);
    assert(!resp.info, 'no download info leaked for anonymous request');
    assert(gfiAttempts >= 1,
        `chain continued past preview-only to get-file-info (${gfiAttempts} attempts)`);

    // ---- test 4b: с cookie сессии токен обязан запрашиваться ДО остальных
    //      стратегий, и забираться с правильными параметрами. -----------------
    let tokenCall = null;
    sandbox.chrome.cookies.getAll = async () => [
        { name: 'Session_id', value: 'fake-session' },
        { name: 'yandex_login', value: 'unit' }
    ];
    sandbox.fetch = (url, init) => {
        if (String(url).includes('oauth.yandex.ru/token')) {
            tokenCall = { url: String(url), init };
            return Promise.resolve(new Response(JSON.stringify({ access_token: 'unit-token', expires_in: 1000 }), {
                status: 200, headers: { 'Content-Type': 'application/json' }
            }));
        }
        return realFetch(url, init);
    };

    const token = await vm.runInContext('getToken({})', ctx);
    assert(token === 'unit-token', `getToken() вернул токен из сессии (${token.slice(0, 12)})`);
    assert(tokenCall && /grant_type=sessionid/.test(String(tokenCall.init.body)),
        'обмен идёт с grant_type=sessionid');
    assert(tokenCall && /Session_id=fake-session/.test(String(tokenCall.init.headers.Cookie)),
        'cookie сессии отправлена в oauth');

    // ---- test 5: download_bytes -> offscreen makes blob URL, SW downloads --
    let makeBlobMsg = null;
    let downloadCallOpts = null;
    sandbox.chrome.runtime.sendMessage = (msg, cb) => {
        if (msg && msg.target === 'offscreen' && msg.action === 'make_blob_url') {
            makeBlobMsg = msg;
            if (cb) cb({ blobUrl: 'blob:chrome-extension://fake/test' });
            return;
        }
        if (msg && msg.target === 'offscreen' && msg.action === 'revoke_blob_url') {
            if (cb) cb({ ok: true });
            return;
        }
        if (cb) cb({});
    };
    sandbox.chrome.downloads.download = (opts, cb) => { downloadCallOpts = opts; cb(77); };

    const dlResp = await send({
        action: 'download_bytes',
        bytesBase64: Buffer.from('ID3test').toString('base64'),
        filename: 'unit.mp3',
        mime: 'audio/mpeg',
        saveAs: false
    });
    assert(makeBlobMsg && makeBlobMsg.bytesBase64, 'offscreen asked to create blob URL');
    assert(downloadCallOpts && downloadCallOpts.url === 'blob:chrome-extension://fake/test',
        'background itself calls chrome.downloads.download with the blob URL');
    assert(downloadCallOpts.filename === 'unit.mp3', 'filename passed through sanitized');
    assert(dlResp.downloadId === 77, 'download result is returned to caller');

    console.log('\nALL HARNESS TESTS PASSED');
})().catch((e) => { console.error('[FAIL] unexpected:', e); process.exit(1); });
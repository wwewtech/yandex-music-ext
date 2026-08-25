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
                lastError: null
            },
            storage: {
                local: {
                    get(keys, cb) { cb({}); },
                    set(obj, cb) { if (cb) cb(); }
                }
            },
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
    //      by preview protection, NOT silently downloaded as 30s file ------
    const resp = await send({ action: 'resolve_track_download', trackId: '153627759', token: '' });
    assert(typeof resp.error === 'string' && resp.error.length > 0,
        'anonymous resolve returns an error (no silent fallback)');
    assert(/превью|Плюс|залогинены/i.test(resp.error),
        `error is actionable for the user: "${resp.error}"`);
    assert(!resp.info, 'no download info leaked for anonymous request');

    // ---- test 5: download_bytes routes through offscreen ----------------
    let offscreenPayload = null;
    sandbox.chrome.runtime.sendMessage = (msg, cb) => {
        if (msg && msg.target === 'offscreen') { offscreenPayload = msg; if (cb) cb({ downloadId: 42 }); return; }
        if (cb) cb({});
    };
    const dlResp = await send({
        action: 'download_bytes',
        bytesBase64: Buffer.from('ID3test').toString('base64'),
        filename: 'unit.mp3',
        mime: 'audio/mpeg',
        saveAs: false
    });
    assert(offscreenPayload && offscreenPayload.action === 'download_blob',
        'download_bytes forwards payload to offscreen document');
    assert(dlResp.downloadId === 42, 'offscreen download result is returned to caller');

    console.log('\nALL HARNESS TESTS PASSED');
})().catch((e) => { console.error('[FAIL] unexpected:', e); process.exit(1); });
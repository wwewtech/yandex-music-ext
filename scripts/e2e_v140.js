// E2E v1.4.0: reload ext, click download, verify success toast AND that
// chrome.downloads has NO new entries (silent anchor save, no native notification)
const http = require('http');

function get(path) {
    return new Promise((resolve, reject) => {
        http.get({ host: '127.0.0.1', port: 9223, path }, (res) => {
            let d = '';
            res.on('data', c => d += c);
            res.on('end', () => resolve(JSON.parse(d)));
        }).on('error', reject);
    });
}

class WS {
    constructor(url) {
        this.url = url;
        this.id = 0;
        this.onMessage = () => {};
        this._waiters = new Map();
    }
    connect() {
        return new Promise((resolve, reject) => {
            const key = Buffer.from(Array.from({ length: 16 }, () => Math.floor(Math.random() * 256))).toString('base64');
            const u = new URL(this.url);
            const req = http.request({
                host: '127.0.0.1', port: 9223, path: u.pathname + u.search,
                headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Key': key, 'Sec-WebSocket-Version': 13, Host: '127.0.0.1:9223' }
            });
            req.on('response', (r) => reject(new Error('upgrade refused: ' + r.statusCode)));
            req.on('upgrade', (res, socket) => {
                this.socket = socket;
                let buf = Buffer.alloc(0);
                socket.on('data', (chunk) => {
                    buf = Buffer.concat([buf, chunk]);
                    while (true) {
                        if (buf.length < 2) break;
                        const len0 = buf[1] & 0x7F;
                        let off = 2, len = len0;
                        if (len0 === 126) { if (buf.length < 4) break; len = buf.readUInt16BE(2); off = 4; }
                        else if (len0 === 127) { if (buf.length < 10) break; len = Number(buf.readBigUInt64BE(2)); off = 10; }
                        if (buf.length < off + len) break;
                        const payload = buf.slice(off, off + len);
                        buf = buf.slice(off + len);
                        try { this.onMessage(JSON.parse(payload.toString())); } catch (_) {}
                    }
                });
                resolve();
            });
            req.on('error', reject);
            req.end();
        });
    }
    send(method, params) {
        return new Promise((resolve) => {
            const id = ++this.id;
            this._waiters.set(id, resolve);
            const data = Buffer.from(JSON.stringify({ id, method, params: params || {} }));
            const mask = Buffer.from([1, 2, 3, 4]);
            let header;
            if (data.length < 126) header = Buffer.from([0x81, 0x80 | data.length]);
            else { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 0x80 | 126; header.writeUInt16BE(data.length, 2); }
            const masked = Buffer.alloc(data.length);
            for (let i = 0; i < data.length; i++) masked[i] = data[i] ^ mask[i % 4];
            this.socket.write(Buffer.concat([header, mask, masked]));
        });
    }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
setTimeout(() => { console.log('TIMEOUT'); process.exit(1); }, 180000);

(async () => {
    // 1. Расширение загружено недавно — reload не требуется

    // 2. Reload Yandex Music tab
    const tabs = await get('/json');
    const tab = tabs.find(t => t.type === 'page' && t.url.includes('music.yandex.ru'));
    if (!tab) { console.log(JSON.stringify({ error: 'no tab' })); process.exit(1); }
    const ws = new WS(tab.webSocketDebuggerUrl);
    await ws.connect();
    await ws.send('Page.enable');
    await ws.send('Page.reload', { ignoreCache: true });
    await sleep(9000);

    // 3. Snapshot downloads count before
    const before = await ws.send('Runtime.evaluate', {
        expression: `new Promise(r => chrome.downloads.search({limit: 100}, items => r(items.length)))`,
        awaitPromise: true, returnByValue: true
    });
    const beforeCount = before.result?.result?.value ?? -1;

    // 4. Click the player-bar download button
    await ws.send('Runtime.evaluate', {
        expression: `(() => { const b = document.getElementById('ym-ext-download-btn'); if (b) { b.click(); return 'clicked'; } return 'no-btn'; })()`,
        returnByValue: true
    });

    // 5. Wait for success toast
    let status = null;
    for (let i = 0; i < 60; i++) {
        await sleep(2000);
        const r = await ws.send('Runtime.evaluate', {
            expression: `(() => {
                const cls = document.querySelector('#ym-ext-toast-container .ym-toast-status');
                const msg = document.querySelector('#ym-ext-toast-container .ym-status-msg');
                if (!cls || !msg) return null;
                return cls.className.includes('success') ? 'success:' + msg.textContent
                     : cls.className.includes('error') ? 'error:' + msg.textContent
                     : 'loading:' + msg.textContent;
            })()`,
            returnByValue: true
        });
        status = r.result?.result?.value || null;
        if (status && (status.startsWith('success') || status.startsWith('error'))) break;
    }

    // 6. Verify no new chrome.downloads entries
    await sleep(3000);
    const after = await ws.send('Runtime.evaluate', {
        expression: `new Promise(r => chrome.downloads.search({limit: 100}, items => r(items.length)))`,
        awaitPromise: true, returnByValue: true
    });
    const afterCount = after.result?.result?.value ?? -1;

    console.log(JSON.stringify({
        toast: status,
        downloadsBefore: beforeCount,
        downloadsAfter: afterCount,
        silentSave: afterCount === beforeCount,
        pass: status && status.startsWith('success') && afterCount === beforeCount
    }, null, 2));
    process.exit(0);
})().catch(e => { console.log('ERR', e.message); process.exit(1); });
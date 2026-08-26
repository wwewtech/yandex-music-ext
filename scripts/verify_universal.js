// Verify universal hover buttons appear next to track links
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
    constructor(url) { this.url = url; this.id = 0; this.onMessage = () => {}; }
    connect() {
        return new Promise((resolve, reject) => {
            const key = Buffer.from(Array.from({ length: 16 }, () => Math.floor(Math.random() * 256))).toString('base64');
            const u = new URL(this.url);
            const req = http.request({
                host: '127.0.0.1', port: 9223, path: u.pathname + u.search,
                headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Key': key, 'Sec-WebSocket-Version': 13, Host: '127.0.0.1:9223' }
            });
            req.on('response', (r) => reject(new Error('upgrade refused ' + r.statusCode)));
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
            this.onMessage = (msg) => { if (msg.id === id) resolve(msg); };
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
setTimeout(() => { console.log('VERIFY TIMEOUT'); process.exit(1); }, 60000);
(async () => {
    const tabs = await get('/json');
    const tab = tabs.find(t => t.type === 'page' && t.url.includes('music.yandex.ru'));
    if (!tab) { console.log('NO TAB'); process.exit(1); }
    const ws = new WS(tab.webSocketDebuggerUrl);
    await ws.connect();
    await sleepSafe(ws);

    async function sleepSafe(ws) {
        // wait for page ready then count
        for (let i = 0; i < 10; i++) {
            await new Promise(r => setTimeout(r, 2000));
            const r = await ws.send('Runtime.evaluate', {
                expression: `({links: document.querySelectorAll('a[href*="/album/"][href*="/track/"]').length, btns: document.querySelectorAll('.ym-ext-hover-btn').length, listBtns: document.querySelectorAll('.ym-ext-list-download-btn').length})`,
                returnByValue: true
            });
            const v = r.result?.result?.value;
            if (v && v.links > 0 && (v.btns > 0 || v.listBtns > 0)) {
                console.log(JSON.stringify({ ...v, pass: true }, null, 1));
                process.exit(0);
            }
            if (i === 9) {
                console.log(JSON.stringify({ ...v, pass: false }, null, 1));
                process.exit(v && v.links > 0 ? 1 : 0);
            }
        }
    }
})().catch(e => { console.log('ERR', e.message); process.exit(1); });
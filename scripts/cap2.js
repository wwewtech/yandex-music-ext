/**
 * Captures ALL get-file-info request/response pairs with bodies.
 */
const http = require('http');
function httpGetJson(url) {
    return new Promise((resolve, reject) => {
        http.get(url, (res) => {
            let d = ''; res.on('data', c => d += c);
            res.on('end', () => resolve(JSON.parse(d)));
        }).on('error', reject);
    });
}

(async () => {
    const targets = await httpGetJson('http://127.0.0.1:9223/json');
    const tab = targets.find(t => t.type === 'page' && /music\.yandex\.ru/.test(t.url));
    if (!tab) { console.log('NO TAB'); process.exit(1); }

    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    let id = 0;
    const pending = new Map();
    const gfi = new Map(); // requestId -> {url, status, body}

    const send = (method, params) => new Promise((res, rej) => {
        const mid = ++id;
        pending.set(mid, { res, rej });
        ws.send(JSON.stringify({ id: mid, method, params }));
    });

    ws.onmessage = async (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.id && pending.has(msg.id)) {
            const { res, rej } = pending.get(msg.id); pending.delete(msg.id);
            msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
            return;
        }
        if (msg.method === 'Network.requestWillBeSent') {
            const u = msg.params.request.url;
            if (u.includes('get-file-info')) gfi.set(msg.params.requestId, { url: u, status: null, body: null });
        } else if (msg.method === 'Network.responseReceived') {
            const r = gfi.get(msg.params.requestId);
            if (r) r.status = msg.params.response.status;
        } else if (msg.method === 'Network.loadingFinished') {
            const r = gfi.get(msg.params.requestId);
            if (r && !r.body) {
                try {
                    const rb = await send('Network.getResponseBody', { requestId: msg.params.requestId });
                    r.body = rb.body;
                } catch (e) { r.body = 'ERR:' + e.message; }
            }
        }
    };

    await new Promise(r => { ws.onopen = r; });
    await send('Network.enable', {});
    await send('Page.enable', {});

    await send('Page.navigate', { url: 'https://music.yandex.ru/album/41209535' });
    await new Promise(r => setTimeout(r, 7000));

    await send('Runtime.evaluate', {
        expression: `(function(){const btns=Array.from(document.querySelectorAll('button[aria-label="Воспроизведение"]')).filter(b=>!b.className.includes('ym-ext'));if(!btns.length)return 'no buttons';btns[0].click();return 'clicked #0';})()`,
        returnByValue: true
    });

    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
        const done = Array.from(gfi.values()).filter(r => r.body);
        if (done.length) break;
        await new Promise(r => setTimeout(r, 500));
    }

    const out = Array.from(gfi.values()).map(r => ({
        url: r.url,
        status: r.status,
        bodyPreview: r.body ? r.body.slice(0, 1200) : null
    }));
    console.log(JSON.stringify(out, null, 2));
    ws.close();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
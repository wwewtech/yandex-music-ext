/**
 * Full CDP network capture: enables Network domain, triggers playback,
 * captures the real get-file-info REQUEST + RESPONSE BODY.
 */
const fs = require('fs');
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
    const events = [];
    let gfiRequestId = null;

    const send = (method, params) => new Promise((res, rej) => {
        const mid = ++id;
        pending.set(mid, { res, rej });
        ws.send(JSON.stringify({ id: mid, method, params }));
    });

    ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.id && pending.has(msg.id)) {
            const { res, rej } = pending.get(msg.id); pending.delete(msg.id);
            msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
        } else if (msg.method === 'Network.requestWillBeSent') {
            const u = msg.params.request.url;
            if (u.includes('get-file-info')) {
                gfiRequestId = msg.params.requestId;
                events.push({ type: 'request', url: u });
            }
        } else if (msg.method === 'Network.responseReceived') {
            if (msg.params.requestId === gfiRequestId) {
                events.push({ type: 'response', status: msg.params.response.status });
            }
        } else if (msg.method === 'Network.loadingFinished') {
            if (msg.params.requestId === gfiRequestId) events.push({ type: 'finished' });
        }
    };

    await new Promise(r => { ws.onopen = r; });
    await send('Network.enable', {});
    await send('Page.enable', {});

    // Fresh album to force a brand-new player queue
    await send('Page.navigate', { url: 'https://music.yandex.ru/album/2307672' });
    await new Promise(r => setTimeout(r, 6000));

    const clickResult = await send('Runtime.evaluate', {
        expression: `(function(){const btns=Array.from(document.querySelectorAll('button[aria-label="Воспроизведение"]')).filter(b=>!b.className.includes('ym-ext'));if(!btns.length)return 'no play buttons';const b=btns[Math.min(1,btns.length-1)];b.click();return 'clicked play button #'+Math.min(1,btns.length-1)+' of '+btns.length;})()`,
        returnByValue: true
    });
    events.push({ type: 'click', result: clickResult.result?.value });

    // Wait for the request+finish
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline && !events.some(e => e.type === 'finished')) {
        await new Promise(r => setTimeout(r, 300));
    }

    let body = null;
    if (gfiRequestId) {
        try {
            const rb = await send('Network.getResponseBody', { requestId: gfiRequestId });
            body = rb.body;
        } catch (e) { body = 'BODY ERROR: ' + e.message; }
    }

    console.log(JSON.stringify({ events, body: body ? body.slice(0, 2000) : null }, null, 2));
    ws.close();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
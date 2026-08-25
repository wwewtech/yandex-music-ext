/**
 * CDP evaluator: runs a JS expression in the context of the music.yandex.ru
 * tab of the debug Chrome instance (port 9222).
 *
 * Usage: node scripts/cdp_eval.js <expression-file-or-"inline:JS">
 */
const fs = require('fs');
const http = require('http');

function httpGetJson(url) {
    return new Promise((resolve, reject) => {
        http.get(url, (res) => {
            let data = '';
            res.on('data', (c) => { data += c; });
            res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
        }).on('error', reject);
    });
}

async function findMusicTab() {
    const targets = await httpGetJson('http://127.0.0.1:9223/json');
    const page = targets.find(t => t.type === 'page' && /music\.yandex\.(ru|com|by|kz)/.test(t.url));
    if (!page) throw new Error('Вкладка music.yandex.ru не найдена. Откройте её в отладочном Chrome.');
    return page;
}

function connect(wsUrl) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl);
        let id = 0;
        const pending = new Map();
        ws.onopen = () => resolve({
            call(method, params) {
                return new Promise((res, rej) => {
                    const mid = ++id;
                    pending.set(mid, { res, rej });
                    ws.send(JSON.stringify({ id: mid, method, params }));
                });
            },
            close() { ws.close(); }
        });
        ws.onerror = (e) => reject(new Error('WebSocket error'));
        ws.onmessage = (ev) => {
            const msg = JSON.parse(ev.data);
            if (msg.id && pending.has(msg.id)) {
                const { res, rej } = pending.get(msg.id);
                pending.delete(msg.id);
                if (msg.error) rej(new Error(JSON.stringify(msg.error)));
                else res(msg.result);
            }
        };
    });
}

(async () => {
    const arg = process.argv[2];
    if (!arg) { console.error('usage: node cdp_eval.js <file|inline:JS>'); process.exit(1); }
    const expr = arg.startsWith('inline:') ? arg.slice(7) : fs.readFileSync(arg, 'utf8');

    const tab = await findMusicTab();
    console.error('[cdp] tab:', tab.url);
    const cdp = await connect(tab.webSocketDebuggerUrl);

    const result = await cdp.call('Runtime.evaluate', {
        expression: `(async () => { ${expr} \n})()`,
        awaitPromise: true,
        returnByValue: true
    });

    if (result.exceptionDetails) {
        console.log('EXCEPTION:', JSON.stringify(result.exceptionDetails, null, 2));
    } else {
        console.log(JSON.stringify(result.result.value, null, 2));
    }
    cdp.close();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
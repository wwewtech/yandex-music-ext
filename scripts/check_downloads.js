// Query chrome.downloads from the extension service worker via CDP
const http = require('http');
function getTargets() {
    return new Promise((resolve, reject) => {
        http.get({ host: '127.0.0.1', port: 9223, path: '/json' }, res => {
            let b = '';
            res.on('data', d => b += d);
            res.on('end', () => resolve(JSON.parse(b)));
        }).on('error', reject);
    });
}
(async () => {
    const targets = await getTargets();
    const sw = targets.find(t => t.type === 'service_worker');
    if (!sw) { console.log('NO SW'); process.exit(1); }
    const ws = new WebSocket(sw.webSocketDebuggerUrl);
    let id = 0;
    const pending = {};
    ws.addEventListener('message', ev => {
        const msg = JSON.parse(ev.data);
        if (msg.id && pending[msg.id]) { pending[msg.id](msg); delete pending[msg.id]; }
    });
    await new Promise(r => ws.addEventListener('open', r));
    const res = await new Promise(resolve => {
        const mid = ++id;
        pending[mid] = resolve;
        ws.send(JSON.stringify({ id: mid, method: 'Runtime.evaluate', params: {
            expression: "new Promise(r => chrome.downloads.search({limit: 5, orderBy: ['-startTime']}, items => r(JSON.stringify(items.map(i => ({id: i.id, state: i.state, filename: i.filename, bytes: i.bytesReceived, error: i.error}))))) )",
            awaitPromise: true, returnByValue: true
        }}));
    });
    console.log(res.result?.result?.value || JSON.stringify(res.result));
    process.exit(0);
})();
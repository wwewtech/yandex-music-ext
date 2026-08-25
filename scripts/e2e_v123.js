// Click the extension download button on track #1 and wait for success toast
const dl = Date.now() + 30000;
while (!document.querySelector('.ym-ext-list-download-btn') && Date.now() < dl) {
    await new Promise(r => setTimeout(r, 500));
}
const btn = document.querySelector('.ym-ext-list-download-btn');
if (!btn) return { error: 'download button not found' };
btn.click();

// Wait for toast to reach success or error
let status = null;
const deadline = Date.now() + 120000;
while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 2000));
    const msg = document.querySelector('#ym-ext-toast-container .ym-status-msg');
    const cls = document.querySelector('#ym-ext-toast-container .ym-toast-status');
    if (msg && cls) {
        status = { text: msg.textContent, state: /success/.test(cls.className) ? 'success' : /error/.test(cls.className) ? 'error' : 'loading' };
        if (status.state !== 'loading') break;
    }
}
return { status };
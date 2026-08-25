// Reproduce & verify fix: cover as ArrayBuffer (as returned by fetchBufferViaBackground)
const fs = require('fs');
const path = require('path');

// Extract YMTag block from content.js
const src = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');
const m = src.match(/const YMTag = \(function \(\) \{[\s\S]*?\}\)\(\);/);
if (!m) { console.log('YMTag block not found'); process.exit(1); }
global.window = {};
global.TextEncoder = TextEncoder;
const YMTag = eval(m[0].replace(/^const YMTag = /, ''));

// Find a real flac-named file on Desktop
const desk = 'C:\\Users\\pasha\\Desktop';
const f = fs.readdirSync(desk).find(n => n.endsWith('.flac'));
if (!f) { console.log('no .flac on desktop'); process.exit(1); }
const b = fs.readFileSync(path.join(desk, f));
console.log('file:', f, b.length);

// Fake big JPEG cover (~200KB) as ArrayBuffer — like fetchBufferViaBackground returns
const fakeCover = new Uint8Array(200 * 1024);
fakeCover[0] = 0xFF; fakeCover[1] = 0xD8;
const ab = fakeCover.buffer.slice(fakeCover.byteOffset, fakeCover.byteOffset + fakeCover.byteLength);

try {
    const out = new Uint8Array(YMTag.detectAndTag(
        b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
        'm4a',
        { title: 'T', artist: 'A', album: 'AL', year: '2026', cover: ab }
    ));
    const s = Buffer.from(out).toString('latin1');
    console.log('OK: out size', out.length, '| ilst:', s.includes('ilst'), '| covr:', s.includes('covr'));
    // top-level atoms sanity
    let off = 0; const tops = [];
    while (off + 8 <= out.length) {
        const dv = new DataView(out.buffer, out.byteOffset + off, 8);
        const sz = dv.getUint32(0);
        const nm = String.fromCharCode(out[off+4], out[off+5], out[off+6], out[off+7]);
        tops.push(nm + ':' + sz);
        if (sz < 8) break;
        off += sz;
    }
    console.log('top atoms:', tops.join(' '), '| end ok:', off === out.length);
} catch (e) {
    console.error('FAIL:', e.constructor.name + ':', e.message);
}
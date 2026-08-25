// Deep analysis of a downloaded file: codec, tags, cover, decode check
const fs = require('fs');
const file = process.argv[2];
if (!file) { console.error('usage: node analyze_file.js <file>'); process.exit(1); }
const b = fs.readFileSync(file);
const u = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
console.log('size:', b.length);

// container
if (u[0] === 0x66 && u[1] === 0x4C && u[2] === 0x61 && u[3] === 0x43) {
    console.log('container: native FLAC');
    process.exit(0);
}
if (u[0] === 0x49 && u[1] === 0x44 && u[2] === 0x33) { console.log('container: MP3+ID3'); process.exit(0); }
const brand = String.fromCharCode(u[8], u[9], u[10], u[11]);
console.log('container: MP4, brand:', brand);

function walk(bytes, start, end, cb, depth) {
    let off = start;
    while (off + 8 <= end && depth < 10) {
        const dv = new DataView(bytes.buffer, bytes.byteOffset + off, Math.min(16, end - off));
        let size = dv.getUint32(0);
        const name = String.fromCharCode(bytes[off+4], bytes[off+5], bytes[off+6], bytes[off+7]);
        let header = 8;
        if (size === 1) { size = Number(dv.getBigUint64(8)); header = 16; }
        else if (size === 0) { size = end - off; }
        if (size < header || off + size > end) return false;
        if (cb(name, off, size, header) === false) return true;
        off += size;
    }
    return off === end;
}

let tops = [];
walk(u, 0, u.length, (name, off, size) => { tops.push(name + ':' + size); });
console.log('top atoms:', tops.join(' '));

// find moov -> udta -> meta -> ilst
function findAtom(bytes, start, end, name) {
    let res = null;
    walk(bytes, start, end, (n, off, size, header) => {
        if (n === name) { res = { off, size, header }; return false; }
    }, 1);
    return res;
}
const moov = findAtom(u, 0, u.length, 'moov');
console.log('moov:', moov ? `@${moov.off} size=${moov.size}` : 'MISSING');
if (!moov) process.exit(1);
const udta = findAtom(u, moov.off + 8, moov.off + moov.size, 'udta');
const meta = udta ? findAtom(u, udta.off + 8, udta.off + udta.size, 'meta') : null;
// meta содержит 4 байта version/flags перед дочерними атомами
const ilst = meta ? findAtom(u, meta.off + meta.header + 4, meta.off + meta.size, 'ilst') : null;
console.log('udta:', !!udta, '| meta:', !!meta, '| ilst:', ilst ? ilst.size : 'MISSING');
if (ilst) {
    const s = Buffer.from(u.slice(ilst.off, ilst.off + ilst.size)).toString('latin1');
    console.log('ilst keys:', ['\u00A9nam','\u00A9ART','\u00A9alb','\u00A9day','covr'].map(k => k + '=' + s.includes(k)).join(' '));
}
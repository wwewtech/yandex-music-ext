// Reproduce: tag the restored original and check whether stco offsets got shifted
const fs = require('fs');
const src = fs.readFileSync('content.js', 'utf8');
const m = src.match(/const YMTag = \(function \(\) \{[\s\S]*?\}\)\(\);/);
global.window = {}; global.TextEncoder = TextEncoder;
const YMTag = eval(m[0].replace(/^const YMTag = /, ''));

function readStco(pathStr) {
    const b = fs.readFileSync(pathStr);
    const u = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
    const refs = [];
    function walk(bytes, start, end, cb, depth = 1) {
        let off = start;
        while (off + 8 <= end && depth < 10) {
            const dv = new DataView(bytes.buffer, bytes.byteOffset + off, Math.min(16, end - off));
            let size = dv.getUint32(0);
            const name = String.fromCharCode(bytes[off+4], bytes[off+5], bytes[off+6], bytes[off+7]);
            let header = 8;
            if (size === 1) { size = Number(dv.getBigUint64(8)); header = 16; }
            else if (size === 0) { size = end - off; }
            if (size < header || off + size > end) return;
            if (cb(name, off, size, header) === false) return;
            off += size;
        }
    }
    (function collect(start, end) {
        walk(u, start, end, (name, off, size, header) => {
            if (['moov','trak','mdia','minf','stbl'].includes(name)) collect(off + header, off + size);
            else if (name === 'stco') {
                const cntOff = off + header + 4;
                const count = (u[cntOff]<<24)|(u[cntOff+1]<<16)|(u[cntOff+2]<<8)|u[cntOff+3];
                const vals = [];
                for (let i = 0; i < count; i++) {
                    const p = cntOff + 4 + i * 4;
                    vals.push(((u[p]<<24)|(u[p+1]<<16)|(u[p+2]<<8)|u[p+3])>>>0);
                }
                refs.push(vals);
            }
        }, 1);
    })(0, u.length);
    return { u, refs };
}

const before = readStco('scripts/restored.m4a');
console.log('BEFORE stco[0] first 3:', before.refs[0].slice(0, 3).join(', '), '| tables:', before.refs.length);

const cover = new Uint8Array(200 * 1024); cover[0] = 0xFF; cover[1] = 0xD8;
const ab = cover.buffer.slice(0, cover.byteLength);
const out = new Uint8Array(YMTag.detectAndTag(
    before.u.buffer.slice(before.u.byteOffset, before.u.byteOffset + before.u.byteLength),
    'm4a',
    { title: 'T', artist: 'A', album: 'AL', year: '2026', cover: ab }
));
fs.writeFileSync('scripts/retagged.m4a', out);

// read stco from retagged in-memory
const dv2 = new DataView(out.buffer);
function walk2(bytes, start, end, cb, depth = 1) {
    let off = start;
    while (off + 8 <= end && depth < 10) {
        let size = dv2.getUint32(off);
        const name = String.fromCharCode(bytes[off+4], bytes[off+5], bytes[off+6], bytes[off+7]);
        let header = 8;
        if (size === 1) { size = Number(d2getBigUint64(off + 8)); header = 16; }
        else if (size === 0) { size = end - off; }
        if (size < header || off + size > end) return;
        if (cb(name, off, size, header) === false) return;
        off += size;
    }
    function d2getBigUint64(o) { return dv2.getBigUint64(o); }
}
const after = [];
(function collect2(start, end) {
    walk2(out, start, end, (name, off, size, header) => {
        if (['moov','trak','mdia','minf','stbl'].includes(name)) collect2(off + header, off + size);
        else if (name === 'stco') {
            const cntOff = off + header + 4;
            const count = dv2.getUint32(cntOff);
            const vals = [];
            for (let i = 0; i < count; i++) vals.push(dv2.getUint32(cntOff + 4 + i * 4));
            after.push(vals);
        }
    }, 1);
})(0, out.length);
console.log('AFTER  stco[0] first 3:', after[0] ? after[0].slice(0, 3).join(', ') : 'NO TABLES', '| tables:', after.length);
console.log('ilst present:', Buffer.from(out).toString('latin1').includes('ilst'));
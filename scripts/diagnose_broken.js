// Diagnose broken tagged file: check chunk offsets point to valid FLAC frames,
// and restore an untagged copy to see if the source audio is intact.
const fs = require('fs');
const b = fs.readFileSync('scripts/user_dl.flac');
const u = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);

function walk(bytes, start, end, cb, depth = 1) {
    let off = start;
    while (off + 8 <= end && depth < 10) {
        const dv = new DataView(bytes.buffer, bytes.byteOffset + off, Math.min(16, end - off));
        let size = dv.getUint32(0);
        const name = String.fromCharCode(bytes[off+4], bytes[off+5], bytes[off+6], bytes[off+7]);
        let header = 8;
        if (size === 1) { size = Number(dv.getBigUint64(8)); header = 16; }
        else if (size === 0) { size = end - off; }
        if (size < header || off + size > end) { console.log('WALK STOP at', off, name, size); return; }
        if (cb(name, off, size, header) === false) return;
        off += size;
    }
}

console.log('first 16 bytes:', Array.from(u.slice(0, 16)).map(x => x.toString(16).padStart(2, '0')).join(' '));
walk(u, 0, u.length, (name, off, size) => console.log('TOP', name, '@' + off, 'size=' + size));

// collect stco tables
const refs = [];
function collect(bytes, start, end, pathStr) {
    walk(bytes, start, end, (name, off, size, header) => {
        const p = pathStr + '/' + name;
        if (['moov','trak','mdia','minf','stbl'].includes(name)) collect(bytes, off + header, off + size, p);
        else if (name === 'stco' || name === 'co64') {
            const cntOff = off + header + 4;
            const count = (bytes[cntOff]<<24)|(bytes[cntOff+1]<<16)|(bytes[cntOff+2]<<8)|bytes[cntOff+3];
            refs.push({ name, tableOff: cntOff + 4, count });
        }
    }, 1);
}
collect(u, 0, u.length, '');

console.log('\nchunk offset tables:', refs.map(r => r.name + 'x' + r.count).join(', '));
let bad = 0, good = 0;
for (const r of refs) {
    for (let i = 0; i < Math.min(r.count, 6); i++) {
        const p = r.tableOff + i * (r.name === 'co64' ? 8 : 4);
        const v = r.name === 'co64'
            ? ((u[p]*0x100000000) + (((u[p+4]<<24)|(u[p+5]<<16)|(u[p+6]<<8)|u[p+7])>>>0))
            : ((u[p]<<24)|(u[p+1]<<16)|(u[p+2]<<8)|u[p+3])>>>0;
        const sig = Array.from(u.slice(v, v + 4)).map(x => x.toString(16).padStart(2,'0')).join(' ');
        // FLAC frame sync: FF F8/FF F9
        const okFlac = u[v] === 0xFF && (u[v+1] & 0xFC) === 0xF8;
        if (okFlac) good++; else bad++;
        console.log(`  ${r.name}[${i}] = ${v} -> [${sig}] ${okFlac ? 'OK(flac-sync)' : 'BAD'}`);
    }
}
console.log('good:', good, 'bad:', bad);

// Restore original: remove our udta, undo moov size and chunk offsets
function findAtom(bytes, start, end, name) {
    let res = null;
    walk(bytes, start, end, (n, off, size, header) => { if (n === name) { res = { off, size, header }; return false; } }, 1);
    return res;
}
const moov = findAtom(u, 0, u.length, 'moov');
const udta = findAtom(u, moov.off + 8, moov.off + moov.size, 'udta');
if (!udta) { console.log('\nno udta found'); process.exit(0); }
console.log('\nudta @' + udta.off, 'size=' + udta.size);
const delta = -udta.size; // removing it shifts everything after by this amount

const parts = [u.subarray(0, udta.off), u.subarray(udta.off + udta.size)];
const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }

// fix moov size
const newMoovSize = moov.size + delta;
out[moov.off] = (newMoovSize >>> 24) & 0xFF; out[moov.off+1] = (newMoovSize >>> 16) & 0xFF;
out[moov.off+2] = (newMoovSize >>> 8) & 0xFF; out[moov.off+3] = newMoovSize & 0xFF;

// undo chunk offsets: everything that was > udta.off gets +udta.size back
const refs2 = [];
collect(out, 0, out.length, '');
for (const r of refs2) {
    for (let i = 0; i < r.count; i++) {
        const p = r.tableOff + i * 4;
        const v = ((out[p]<<24)|(out[p+1]<<16)|(out[p+2]<<8)|out[p+3])>>>0;
        if (v > udta.off) {
            const nv = v - delta;
            out[p] = (nv >>> 24) & 0xFF; out[p+1] = (nv >>> 16) & 0xFF; out[p+2] = (nv >>> 8) & 0xFF; out[p+3] = nv & 0xFF;
        }
    }
}
fs.writeFileSync('scripts/restored.m4a', out);
console.log('\nwrote scripts/restored.m4a', out.length);
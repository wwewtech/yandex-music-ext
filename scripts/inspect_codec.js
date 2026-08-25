// Inspect real codec inside MP4/M4A files on Desktop
const fs = require('fs');
const path = require('path');

function walk(buf, start, end, cb, depth) {
    let off = start;
    while (off + 8 <= end && depth < 8) {
        const dv = new DataView(buf.buffer, buf.byteOffset + off, Math.min(16, end - off));
        let size = dv.getUint32(0);
        const name = String.fromCharCode(buf[off+4], buf[off+5], buf[off+6], buf[off+7]);
        let header = 8;
        if (size === 1) { size = Number(dv.getBigUint64(8)); header = 16; }
        else if (size === 0) { size = end - off; }
        if (size < header || off + size > end) break;
        cb(name, off, size, header);
        off += size;
    }
}

function analyze(file) {
    const b = fs.readFileSync(file);
    const u = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
    console.log('===', path.basename(file), '(' + b.length + ' bytes)');
    if (u[0] === 0x66 && u[1] === 0x4C && u[2] === 0x61 && u[3] === 0x43) {
        // native FLAC: read STREAMINFO for sample rate/bits/channels
        const sr = (u[18] << 12) | (u[19] << 4) | (u[20] >> 4);
        const ch = ((u[20] >> 1) & 7) + 1;
        const bits = ((u[20] & 1) << 4) | (u[21] >> 4);
        console.log('  native FLAC:', sr, 'Hz,', bits, 'bit,', ch, 'ch');
        return;
    }
    if (!(u[4] === 0x66 && u[5] === 0x74 && u[6] === 0x79 && u[7] === 0x70)) {
        if (u[0] === 0x49 && u[1] === 0x44 && u[2] === 0x33) { console.log('  MP3 with ID3'); return; }
        console.log('  unknown container'); return;
    }
    const brand = String.fromCharCode(u[8], u[9], u[10], u[11]);
    console.log('  brand:', brand);
    let found = [];
    function scan(start, end, depth) {
        walk(u, start, end, (name, off, size, header) => {
            if (['moov','trak','mdia','minf','stbl'].includes(name)) scan(off+header, off+size, depth+1);
            else if (name === 'stsd') {
                // entries start at off+header+8
                let p = off + header + 8;
                while (p + 8 <= off + size) {
                    const sz2 = (u[p]<<24)|(u[p+1]<<16)|(u[p+2]<<8)|u[p+3];
                    const nm = String.fromCharCode(u[p+4],u[p+5],u[p+6],u[p+7]);
                    found.push(nm);
                    // look inside sample entry for esds/flac
                    const inner = Buffer.from(u.slice(p, p + sz2)).toString('latin1');
                    if (nm === 'mp4a') {
                        const esds = inner.includes('esds');
                        // find DecoderSpecific object type from esds is complex; report presence
                        found.push(esds ? '(esds:AAC?)' : '(no esds)');
                        if (inner.includes('fLaC')) found.push('(ALAC/FLAC-in-mp4a?)');
                    }
                    p += sz2;
                }
            } else if (name === 'moof') { found.push('FRAGMENTED(moof)!'); }
        }, depth);
    }
    scan(0, u.length, 0);
    console.log('  sample entries:', found.join(' '));
    // estimate bitrate assuming ~duration from mdhd would be complex; print size only
}

const desk = 'C:\\Users\\pasha\\Desktop';
for (const n of fs.readdirSync(desk)) {
    if (/\.(flac|m4a|mp3)$/i.test(n)) analyze(path.join(desk, n));
}
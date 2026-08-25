const b = require('fs').readFileSync(__dirname + '\\test_track.bin');
console.log('size:', b.length);
const s = b.toString('latin1');
if (s.startsWith('fLaC')) {
    console.log('container: FLAC (lossless)');
    let off = 4;
    const blocks = [];
    while (off < b.length - 4) {
        const h = b[off];
        const type = h & 0x7F;
        const len = (b[off+1] << 16) | (b[off+2] << 8) | b[off+3];
        blocks.push({ type, len });
        off += 4 + len;
        if (h & 0x80) break;
    }
    console.log('meta blocks:', JSON.stringify(blocks));
    console.log('VORBIS_COMMENT:', blocks.some(x => x.type === 4), '| PICTURE:', blocks.some(x => x.type === 6));
    const vi = s.indexOf('TITLE=');
    if (vi > 0) console.log('TITLE=', JSON.stringify(s.substr(vi + 6, 50)));
    const ai = s.indexOf('ARTIST=');
    if (ai > 0) console.log('ARTIST=', JSON.stringify(s.substr(ai + 7, 50)));
    const li = s.indexOf('ALBUM=');
    if (li > 0) console.log('ALBUM=', JSON.stringify(s.substr(li + 6, 50)));
} else if (b.slice(4, 8).toString('latin1') === 'ftyp') {
    console.log('container: M4A');
    console.log('ilst:', s.includes('ilst'), '| covr:', s.includes('covr'), '| \u00A9nam:', s.includes('\u00A9nam'));
} else {
    console.log('container:', b.slice(0, 4).toString('hex'), s.startsWith('ID3') ? 'MP3 with ID3' : '');
}
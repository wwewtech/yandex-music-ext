const b = require('fs').readFileSync(__dirname + '\\test_track.mp3');
console.log('size:', b.length);
const s = b.toString('latin1');
console.log('starts with ID3:', s.startsWith('ID3'));
if (s.startsWith('ID3')) {
    const ver = b[3];
    const size = (b[6] << 21) | (b[7] << 14) | (b[8] << 7) | b[9];
    console.log('ID3v2.' + ver + ', tag size:', size);
    const tag = s.slice(10, 10 + size);
    const grab = (id) => {
        const i = tag.indexOf(id);
        if (i < 0) return null;
        // frame: id(4) size(4) flags(2) then data; try to read utf8 text
        const fsz = (tag.charCodeAt(i + 4) << 24) | (tag.charCodeAt(i + 5) << 16) | (tag.charCodeAt(i + 6) << 8) | tag.charCodeAt(i + 7);
        const raw = tag.substr(i + 11, Math.min(fsz - 1, 60));
        return raw.replace(/\0/g, '').trim();
    };
    console.log('TIT2:', JSON.stringify(grab('TIT2')));
    console.log('TPE1:', JSON.stringify(grab('TPE1')));
    console.log('TALB:', JSON.stringify(grab('TALB')));
    console.log('APIC (cover):', tag.includes('APIC'));
}
// audio duration estimate from first frame header
let off = s.startsWith('ID3') ? ((b[6] << 21) | (b[7] << 14) | (b[8] << 7) | b[9]) + 10 : 0;
for (let i = off; i < b.length - 4; i++) {
    if (b[i] === 0xFF && (b[i + 1] & 0xE0) === 0xE0) {
        const bitrateIdx = (b[i + 2] >> 4) & 0xF;
        const samplerateIdx = (b[i + 3] >> 2) & 0x3;
        const v1l3 = [0,32,40,48,56,64,80,96,112,128,160,192,224,256,320][bitrateIdx];
        const sr = [44100,48000,32000][samplerateIdx] || 44100;
        console.log('first frame @', i, 'bitrate:', v1l3 + 'kbps', 'samplerate:', sr);
        break;
    }
}
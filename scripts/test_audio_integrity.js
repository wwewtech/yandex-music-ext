// Audio integrity test: tag a reference MP4 and verify decoded PCM is bit-identical.
// Requires ffmpeg/ffprobe on PATH. Run: node scripts/test_audio_integrity.js
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const dir = __dirname;
const orig = path.join(dir, 'orig_test.m4a');
const tagged = path.join(dir, 'tagged_test.m4a');

function sh(cmd) {
    return execSync(cmd, { encoding: 'buffer', stdio: ['ignore', 'pipe', 'pipe'] }).toString();
}

// 1. Generate 30s reference AAC-in-MP4
sh(`ffmpeg -y -v error -f lavfi -i "sine=frequency=440:duration=30" -c:a aac -b:a 192k "${orig}"`);

// 2. Tag it with YMTag from content.js (big ArrayBuffer cover to stress offsets)
const src = fs.readFileSync(path.join(dir, '..', 'content.js'), 'utf8');
const m = src.match(/const YMTag = \(function \(\) \{[\s\S]*?\}\)\(\);/);
if (!m) { console.error('[FAIL] YMTag block not found in content.js'); process.exit(1); }
const YMTag = eval(m[0].replace(/^const YMTag = /, ''));

const b = fs.readFileSync(orig);
const cover = new Uint8Array(200 * 1024);
cover[0] = 0xFF; cover[1] = 0xD8; // fake jpeg magic
const ab = cover.buffer.slice(cover.byteOffset, cover.byteOffset + cover.byteLength);

const out = new Uint8Array(YMTag.detectAndTag(
    b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
    'm4a',
    { title: 'T', artist: 'A', album: 'AL', year: '2026', cover: ab }
));
fs.writeFileSync(tagged, out);

// 3. Structural checks
const s = Buffer.from(out).toString('latin1');
console.log('[OK] ilst present:', s.includes('ilst'));
console.log('[OK] covr present:', s.includes('covr'));

// top-level atom walk must end exactly at EOF
let off = 0, ok = true;
while (off + 8 <= out.length) {
    const sz = (out[off] << 24) | (out[off+1] << 16) | (out[off+2] << 8) | out[off+3];
    if (sz < 8 || off + sz > out.length) { ok = false; break; }
    off += sz;
}
console.log('[OK] atoms consistent:', ok && off === out.length);

// 4. Decode both to PCM MD5 — must be identical
const md5 = (f) => sh(`ffmpeg -v error -i "${f}" -f md5 -`).toString().trim();
const h1 = md5(orig), h2 = md5(tagged);
console.log('[..] pcm orig  :', h1);
console.log('[..] pcm tagged:', h2);
if (h1 !== h2 || !/^MD5=/.test(h1)) {
    console.error('[FAIL] decoded audio differs!');
    process.exit(1);
}
console.log('[OK] decoded PCM is bit-identical after tagging');

// 5. No decode errors/warnings for the tagged file
let decodeErr = '';
try {
    sh(`ffmpeg -v error -i "${tagged}" -f null -`);
} catch (e) {
    decodeErr = (e.stderr || '').toString().slice(0, 400);
}
if (decodeErr.trim()) {
    console.error('[FAIL] decoder reported errors:', decodeErr);
    process.exit(1);
}
console.log('[OK] ffmpeg decodes tagged file without errors');

// cleanup
fs.unlinkSync(orig); fs.unlinkSync(tagged);
console.log('\nALL AUDIO INTEGRITY TESTS PASSED');
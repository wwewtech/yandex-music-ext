// Offline MP3 tagging test: real ID3Writer from id3-writer.js, real ffmpeg decode.
// Verifies the MP3 path end-to-end without any browser.
// Run: node scripts/test_mp3_tagging.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execSync } = require('child_process');

const dir = __dirname;
const orig = path.join(dir, 'orig_test.mp3');
const tagged = path.join(dir, 'tagged_test.mp3');

function sh(cmd) {
    return execSync(cmd, { encoding: 'buffer', stdio: ['ignore', 'pipe', 'pipe'] }).toString();
}
function assert(cond, msg) {
    if (!cond) { console.error('[FAIL]', msg); process.exit(1); }
    console.log('[OK]', msg);
}

// 1. Источник — реальный MP3 320k и настоящая обложка (иначе ffmpeg ругается
// на фиктивный JPEG, который пишется в APIC).
sh(`ffmpeg -y -v error -f lavfi -i "sine=frequency=440:duration=30" -c:a libmp3lame -b:a 320k "${orig}"`);
const coverPath = path.join(dir, 'cover_test.jpg');
sh(`ffmpeg -y -v error -f lavfi -i "color=c=0x334455:s=300x300:d=1" -frames:v 1 "${coverPath}"`);

// 2. Загружаем НАСТОЯЩИЙ id3-writer.js в песочницу
const sandbox = { console, TextEncoder, window: {} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(dir, '..', 'id3-writer.js'), 'utf8'), sandbox);
const ID3Writer = sandbox.window.ID3Writer;
assert(typeof ID3Writer === 'function', 'id3-writer.js экспортирует ID3Writer');

// 3. Тегируем как расширение: TIT2/TPE1/TALB/TYER + обложка
const raw = fs.readFileSync(orig);
const audio = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
const cover = new Uint8Array(fs.readFileSync(coverPath));
const coverAb = cover.buffer.slice(cover.byteOffset, cover.byteOffset + cover.byteLength);

const writer = new ID3Writer(audio);
writer.addTextFrame('TIT2', 'Лицо Затоптали');
writer.addTextFrame('TPE1', 'VILLIAN');
writer.addTextFrame('TALB', 'Красивое Зло');
writer.addTextFrame('TYER', '2026');
writer.addPictureFrame(coverAb, 'image/jpeg');
const out = Buffer.from(writer.getTaggedBuffer());
fs.writeFileSync(tagged, out);

// 4. Структура ID3v2.3
assert(out.subarray(0, 3).toString('latin1') === 'ID3', 'файл начинается с ID3');
assert(out[3] === 3, 'версия ID3 = 2.3');
const sizeBytes = out.subarray(6, 10);
const tagSize = (sizeBytes[0] << 21) | (sizeBytes[1] << 14) | (sizeBytes[2] << 7) | sizeBytes[3];
assert(tagSize > 0 && tagSize < out.length, `syncsafe-размер тега корректен (${tagSize})`);

// 5. Кадры: идём по телу и проверяем, что размеры не выходят за тег
let off = 10, frames = [];
while (off + 10 <= 10 + tagSize) {
    const id = out.subarray(off, off + 4).toString('latin1');
    if (!/^[A-Z0-9]{4}$/.test(id)) break;
    const len = out.readUInt32BE(off + 4);
    assert(off + 10 + len <= 10 + tagSize, `кадр ${id} не выходит за границы тега`);
    frames.push({ id, len });
    off += 10 + len;
}
const ids = frames.map(f => f.id);
for (const want of ['TIT2', 'TPE1', 'TALB', 'TYER', 'APIC']) {
    assert(ids.includes(want), `кадр ${want} записан`);
}
assert(off === 10 + tagSize, 'тело тега разобрано ровно до конца');

// 6. Аудио после тега не тронуто
const audioStart = 10 + tagSize;
assert(out.subarray(audioStart).equals(raw), 'аудиоданные побитово идентичны исходным');

// 7. Декодируется и длительность совпадает
const dur = Number(sh(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${tagged}"`).trim());
assert(Math.abs(dur - 30) < 1, `ffprobe читает файл, длительность ${dur.toFixed(1)}с`);
const text = out.toString('latin1');
assert(text.includes('Лицо') === false, 'UTF-16 текст в latin1 напрямую не виден (ожидаемо)');
sh(`ffmpeg -y -v error -i "${tagged}" -f null -`);

console.log('\nALL MP3 TAGGING TESTS PASSED');
fs.unlinkSync(orig); fs.unlinkSync(tagged); fs.unlinkSync(coverPath);

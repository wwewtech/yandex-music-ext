/**
 * Yandex Music Downloader — Tag Writers for M4A (MP4) and FLAC.
 * Работает в content script (подключается перед content.js).
 *
 * - tagM4a(arrayBuffer, tags): вставляет moov.udta.meta.ilst с текстовыми
 *   атомами и обложкой; корректно пересчитывает размеры атомов и чанк-офсеты
 *   (stco/co64), если данные лежат после точки вставки.
 * - tagFlac(arrayBuffer, tags): вставляет блоки VORBIS_COMMENT и PICTURE
 *   перед первым аудиоблоком (метаданные всегда до аудио — офсеты не страдают).
 */
(function () {
    'use strict';

    /* ============================ общие утилиты ============================ */

    function u32(v) { return [(v >>> 24) & 0xFF, (v >>> 16) & 0xFF, (v >>> 8) & 0xFF, v & 0xFF]; }

    function ascii(str) {
        const out = new Uint8Array(str.length);
        for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xFF;
        return out;
    }

    function utf8(str) { return new TextEncoder().encode(String(str || '')); }

    function concat(chunks) {
        let total = 0;
        for (const c of chunks) total += c.length;
        const out = new Uint8Array(total);
        let off = 0;
        for (const c of chunks) { out.set(c, off); off += c.length; }
        return out;
    }

    function bytesToU32(b, o) { return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0; }
    function bytesToU64(b, o) {
        // безопасно до 2^53
        return bytesToU32(b, o) * 0x100000000 + bytesToU32(b, o + 4);
    }

    /* ============================== MP4 / M4A ============================== */

    function buildDataAtom(typeFlags, payloadBytes) {
        // 'data' atom: size + 'data' + 4 bytes (type flag + locale) + payload
        const body = concat([u32(typeFlags), [0, 0, 0, 0], payloadBytes]);
        return concat([u32(body.length + 8), ascii('data'), body]);
    }

    function buildIlstAtom(name, inner) {
        const body = concat([ascii(name), inner]);
        return concat([u32(body.length + 8), body]);
    }

    const MP4_TEXT_FLAGS = 0x00000001; // UTF-8 text
    const MP4_JPEG_FLAGS = 0x0000000D; // binary image (jpeg/png by content)
    const MP4_PNG_FLAGS = 0x0000000E;

    function buildIlst(tags) {
        const atoms = [];
        const addText = (name, value) => {
            if (!value) return;
            atoms.push(buildIlstAtom(name, buildDataAtom(MP4_TEXT_FLAGS, utf8(value))));
        };
        addText('\u00A9nam', tags.title);
        addText('\u00A9ART', tags.artist);
        addText('aART', tags.artist);
        addText('\u00A9alb', tags.album);
        addText('\u00A9day', tags.year);
        addText('\u00A9gen', tags.genre);
        if (tags.cover) {
            const isPng = tags.cover.length > 8 &&
                tags.cover[0] === 0x89 && tags.cover[1] === 0x50 && tags.cover[2] === 0x4E && tags.cover[3] === 0x47;
            atoms.push(buildIlstAtom('covr', buildDataAtom(isPng ? MP4_PNG_FLAGS : MP4_JPEG_FLAGS, tags.cover)));
        }
        return concat(atoms);
    }

    // Рекурсивный проход атомов контейнера; вызывает cb(name, bodyStart, bodyEnd, headerSize)
    function walkAtoms(bytes, start, end, cb) {
        let off = start;
        while (off + 8 <= end) {
            let size = bytesToU32(bytes, off);
            const name = String.fromCharCode(bytes[off + 4], bytes[off + 5], bytes[off + 6], bytes[off + 7]);
            let header = 8;
            if (size === 1) { // 64-bit size
                size = bytesToU64(bytes, off + 8);
                header = 16;
            } else if (size === 0) {
                size = end - off;
            }
            if (size < header || off + size > end) break;
            cb(name, off, size, header);
            off += size;
        }
    }

    // Собирает список путей stco/co64: [{absOffsetOfChunkTable, isCo64}]
    function findChunkOffsets(bytes, start, end, out) {
        walkAtoms(bytes, start, end, (name, off, size, header) => {
            const bodyStart = off + header;
            if (name === 'moov' || name === 'trak' || name === 'mdia' || name === 'minf' || name === 'stbl') {
                findChunkOffsetEntries(bytes, bodyStart, off + size, out);
            }
        });
    }
    function findChunkOffsetEntries(bytes, start, end, out) {
        walkAtoms(bytes, start, end, (name, off, size, header) => {
            if (name === 'stco' || name === 'co64') {
                const entryCountOff = off + header + 4;
                const count = bytesToU32(bytes, entryCountOff);
                out.push({ tableOff: entryCountOff + 4, count, isCo64: name === 'co64' });
            }
        });
    }

    /**
     * Вставляет метаданные в MP4/M4A. Возвращает новый ArrayBuffer.
     */
    function tagM4a(arrayBuffer, tags) {
        const src = new Uint8Array(arrayBuffer);
        if (src.length < 16) throw new Error('Файл слишком мал для MP4');

        // Ищем moov среди top-level атомов
        let moovOff = -1, moovSize = 0;
        walkAtoms(src, 0, src.length, (name, off, size) => {
            if (name === 'moov') { moovOff = off; moovSize = size; }
        });
        if (moovOff < 0) throw new Error('MP4: атом moov не найден');

        // Ищем udta -> meta -> ilst внутри moov
        let udtaOff = -1, udtaSize = 0, metaOff = -1, metaSize = 0, metaHeader = 8, ilstOff = -1, ilstSize = 0;
        walkAtoms(src, moovOff + 8, moovOff + moovSize, (name, off, size, header) => {
            if (name === 'udta') { udtaOff = off; udtaSize = size; }
        });
        if (udtaOff >= 0) {
            walkAtoms(src, udtaOff + 8, udtaOff + udtaSize, (name, off, size, header) => {
                if (name === 'meta') { metaOff = off; metaSize = size; metaHeader = header; }
            });
        }
        if (metaOff >= 0) {
            // meta содержит 4 байта version/flags сразу после заголовка
            walkAtoms(src, metaOff + metaHeader + 4, metaOff + metaSize, (name, off, size) => {
                if (name === 'ilst') { ilstOff = off; ilstSize = size; }
            });
        }

        const newIlstPayload = buildIlst(tags);

        // Формируем новую цепочку udta/meta/ilst
        const newMetaBody = concat([[0, 0, 0, 0], u32(newIlstPayload.length + 8), ascii('ilst'), newIlstPayload]);
        const newMeta = concat([u32(newMetaBody.length + 8), ascii('meta'), newMetaBody]);
        const newUdta = concat([u32(newMeta.length + 8), ascii('udta'), newMeta]);

        // Точка вставки: внутрь moov, после последнего существующего дочернего атома
        // (или сразу после заголовка moov). Существующие udta заменяем новым.
        let insertAt, removeStart = -1, removeEnd = -1;
        if (udtaOff >= 0) {
            removeStart = udtaOff; removeEnd = udtaOff + udtaSize;
            insertAt = udtaOff;
        } else {
            // вставляем в конец moov
            insertAt = moovOff + moovSize;
        }

        const delta = newUdta.length - (removeStart >= 0 ? removeEnd - removeStart : 0);

        // Собираем результат
        const result = new Uint8Array(src.length + Math.max(delta, 0) - Math.min(delta, 0) * 0);
        // проще: собрать через куски
        const parts = [];
        parts.push(src.subarray(0, insertAt));
        if (removeStart >= 0 && removeEnd > removeStart) {
            // пропускаем старый udta, вставляем новый
            parts.push(newUdta);
            parts.push(src.subarray(removeEnd));
        } else {
            parts.push(newUdta);
            parts.push(src.subarray(insertAt));
        }
        const out = concat(parts);

        // Обновляем размер moov
        const newMoovSize = moovSize + delta;
        out[moovOff] = (newMoovSize >>> 24) & 0xFF;
        out[moovOff + 1] = (newMoovSize >>> 16) & 0xFF;
        out[moovOff + 2] = (newMoovSize >>> 8) & 0xFF;
        out[moovOff + 3] = newMoovSize & 0xFF;

        // Корректируем чанк-офсеты: если сэмплы лежат ПОСЛЕ точки вставки,
        // их абсолютные позиции сдвинулись на delta.
        if (delta !== 0) {
            const refs = [];
            findChunkOffsets(out, moovOff, moovOff + newMoovSize, refs);
            for (const ref of refs) {
                for (let i = 0; i < ref.count; i++) {
                    const p = ref.tableOff + i * (ref.isCo64 ? 8 : 4);
                    if (ref.isCo64) {
                        const v = bytesToU64(out, p);
                        if (v > insertAt) {
                            const nv = v + delta;
                            out.set(u32(Math.floor(nv / 0x100000000)), p);
                            out.set(u32(nv >>> 0), p + 4);
                        }
                    } else {
                        const v = bytesToU32(out, p);
                        if (v > insertAt) out.set(u32(v + delta), p);
                    }
                }
            }
        }

        return out.buffer;
    }

    /* ================================= FLAC ================================= */

    function buildVorbisCommentBlock(tags) {
        // METADATA_BLOCK_VORBIS_COMMENT
        const vendor = utf8('Yandex Music Downloader');
        const comments = [];
        const push = (k, v) => {
            if (!v) return;
            const kv = concat([utf8(k), utf8('=' + v)]);
            comments.push(concat([u32(kv.length), kv]));
        };
        push('TITLE', tags.title);
        push('ARTIST', tags.artist);
        push('ALBUM', tags.album);
        push('DATE', tags.year);
        push('GENRE', tags.genre);

        const listBody = concat([u32(vendor.length), vendor, u32(comments.length), ...comments]);

        const header = concat([
            [0x04], // block type 4, last-flag пока 0
            u32(listBody.length)
        ]);
        return { block: concat([header, listBody]), isLast: false, type: 4 };
    }

    function buildPictureBlock(cover) {
        // METADATA_BLOCK_PICTURE
        const mime = (cover.length > 8 && cover[0] === 0x89 && cover[1] === 0x50) ? 'image/png' : 'image/jpeg';
        const desc = utf8('');
        const body = concat([
            u32(3),                 // type: front cover
            u32(mime.length), utf8(mime),
            u32(desc.length), desc,
            u32(0), u32(0), u32(0), u32(0), // width, height, depth, colors
            u32(cover.length),
            cover
        ]);
        const header = concat([[0x06], u32(body.length)]); // block type 6
        return { block: concat([header, body]), isLast: false, type: 6 };
    }

    function tagFlac(arrayBuffer, tags) {
        const src = new Uint8Array(arrayBuffer);
        if (src.length < 8 || src[0] !== 0x66 || src[1] !== 0x4C || src[2] !== 0x61 || src[3] !== 0x43) {
            throw new Error('FLAC: неверный заголовок');
        }

        // Разбираем существующие метаблоки
        const blocks = [];
        let off = 4;
        let sawLast = false;
        while (off < src.length) {
            const head = src[off];
            const isLast = !!(head & 0x80);
            const type = head & 0x7F;
            const len = (src[off + 1] << 16) | (src[off + 2] << 8) | src[off + 3];
            const body = src.slice(off + 4, off + 4 + len);
            blocks.push({ type, body, isLast });
            off += 4 + len;
            if (isLast) { sawLast = true; break; }
        }
        if (!sawLast) throw new Error('FLAC: повреждённые метаблоки');

        // Удаляем старые VORBIS_COMMENT/PICTURE, добавляем свои
        const kept = blocks.filter(b => b.type !== 0 && b.type !== 4 && b.type !== 6);
        const newBlocks = [
            buildVorbisCommentBlock(tags),
            ...(tags.cover ? [buildPictureBlock(coverSafe(tags.cover))] : [])
        ];

        // Последний блок в новом списке должен иметь флаг last
        const all = [...kept.map(b => ({ block: null, b })), ...newBlocks.map(nb => ({ block: nb.block, b: null }))];

        const parts = [src.slice(0, 4)]; // 'fLaC'
        const total = all.length;
        all.forEach((item, idx) => {
            let raw;
            if (item.b) {
                const flag = (idx === total - 1 ? 0x80 : 0) | item.b.type;
                raw = concat([[flag], u32(item.b.body.length), item.b.body]);
            } else {
                // item.block уже содержит заголовок с флагом 0 — перепишем флаг
                const arr = new Uint8Array(item.block);
                if (idx === total - 1) arr[0] |= 0x80;
                raw = arr;
            }
            parts.push(raw);
        });
        parts.push(src.slice(off)); // аудиоданные

        return concat(parts).buffer;
    }

    function coverSafe(c) { return c; }

    /* ================================ экспорт =============================== */

    window.YMTagWriters = {
        tagM4a,
        tagFlac,
        detectAndTag(arrayBuffer, container, tags) {
            if (container === 'm4a') return tagM4a(arrayBuffer, tags);
            if (container === 'flac') return tagFlac(arrayBuffer, tags);
            throw new Error('Тегирование для контейнера ' + container + ' не поддерживается');
        }
    };
})();
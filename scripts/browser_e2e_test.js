/**
 * E2E TEST — вставьте ВЕСЬ этот файл в консоль DevTools (F12) на открытой
 * вкладке music.yandex.ru (вы должны быть залогинены) и нажмите Enter.
 *
 * Тест прогоняет тот же конвейер, что и расширение, с вашей cookie-сессией:
 *   1. /tracks/{id}/download-info  → есть ли полный трек (не preview)
 *   2. get-file-info с HMAC-подписью → прямая ссылка
 *   3. Скачивание + расшифровка AES-CTR + проверка заголовков файла
 *   4. Сохранение файла через <a download>
 *
 * Ожидаемый результат: скачанный .m4a/.mp3 файл играет ПОЛНОСТЬЮ,
 * в консоли: "E2E OK".
 */
(async function ymE2E() {
    const TRACK_ID = '153627759'; // Big Baby Tape — DRUNK... замените при желании
    const KEY = 'p93jhgh689SBReK6ghtw62';
    const CODECS = 'flac,flac-mp4,mp3,aac,he-aac,aac-mp4,he-aac-mp4';
    const log = (...a) => console.log('%c[E2E]', 'color:#0af;font-weight:bold', ...a);

    // --- шаг 1: download-info с cookie-сессией --------------------------
    const diRes = await fetch(`https://api.music.yandex.net/tracks/${TRACK_ID}/download-info`, {
        credentials: 'include',
        headers: { 'Accept': 'application/json' }
    });
    const di = await diRes.json();
    const items = di.result || [];
    log('download-info варианты:', items.map(i => `${i.codec}/${i.bitrateInKbps}kbps/preview=${i.preview}`).join(', '));

    // --- шаг 2: get-file-info с подписью ---------------------------------
    const ts = Math.floor(Date.now() / 1000);
    const enc = new TextEncoder();
    const hmacKey = await crypto.subtle.importKey('raw', enc.encode(KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sigBuf = await crypto.subtle.sign('HMAC', hmacKey, enc.encode(`${ts}${TRACK_ID}nq${CODECS.replace(/,/g, '')}encraw`));
    let sign = btoa(String.fromCharCode(...new Uint8Array(sigBuf)));
    sign = sign.slice(0, -1);

    const gfiRes = await fetch(`https://api.music.yandex.ru/get-file-info?ts=${ts}&trackId=${TRACK_ID}&quality=nq&codecs=${encodeURIComponent(CODECS)}&transports=encraw&sign=${encodeURIComponent(sign)}`, {
        credentials: 'include',
        headers: { 'Accept': 'application/json' }
    });
    const gfi = await gfiRes.json();
    if (!gfiRes.ok) {
        console.error('[E2E] get-file-info HTTP', gfiRes.status, JSON.stringify(gfi).slice(0, 300));
        return;
    }
    const info = gfi.result?.downloadInfo || gfi.downloadInfo || gfi.result;
    const url = info?.url || info?.urls?.[0];
    const decKey = info?.key;
    log('get-file-info:', { codec: info?.codec, bitrate: info?.bitrate || info?.bitrateInKbps, hasKey: !!decKey });

    // --- шаг 3: скачивание + расшифровка ---------------------------------
    const audioRes = await fetch(url);
    if (!audioRes.ok) { console.error('[E2E] audio HTTP', audioRes.status); return; }
    let bytes = new Uint8Array(await audioRes.arrayBuffer());
    log('скачано байт:', bytes.length);

    if (decKey) {
        const kb = new Uint8Array(decKey.length / 2);
        for (let i = 0; i < kb.length; i++) kb[i] = parseInt(decKey.substr(i * 2, 2), 16);
        const aesKey = await crypto.subtle.importKey('raw', kb, { name: 'AES-CTR' }, false, ['decrypt']);
        bytes = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-CTR', counter: new Uint8Array(16), length: 128 }, aesKey, bytes));
        log('расшифровано AES-CTR');
    }

    // --- шаг 4: проверка контейнера --------------------------------------
    const ascii = (b) => String.fromCharCode(b);
    let kind = 'unknown';
    if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) kind = 'mp3 (ID3)';
    else if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) kind = 'm4a (ftyp)';
    else if (ascii(bytes[0]) + ascii(bytes[1]) + ascii(bytes[2]) + ascii(bytes[3]) === 'fLaC') kind = 'flac';
    log('контейнер файла:', kind);

    if (kind === 'unknown') {
        console.error('[E2E] FAIL: файл не распознан как аудио — вероятно, не расшифрован или нет доступа.');
        return;
    }

    // --- шаг 5: сохранение ------------------------------------------------
    const blob = new Blob([bytes], { type: 'application/octet-stream' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `e2e_test_${TRACK_ID}.${kind.startsWith('mp3') ? 'mp3' : kind.startsWith('flac') ? 'flac' : 'm4a'}`;
    document.body.appendChild(a); a.click(); a.remove();

    log(`E2E OK — файл сохранён (${(bytes.length / 1024 / 1024).toFixed(2)} MB). Прослушайте его: если играет дольше 30 секунд — полный трек доступен и расширение будет работать.`);
})();
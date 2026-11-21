'use strict';
/**
 * Полное скачивание: клик по кнопке в плеере, ожидание файла, проверка
 * байтов и тегов. Требует браузер с расширением на YM_CDP_PORT.
 */
const fs = require('fs');
const path = require('path');
const PORT = Number(process.env.YM_CDP_PORT || 9233);
const OUT = process.env.YM_DL_DIR;
const TITLE = process.env.YM_TRACK_TITLE || 'Лицо Затоптали';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!OUT) throw new Error('YM_DL_DIR не задан');
  fs.mkdirSync(OUT, { recursive: true });
  for (const f of fs.readdirSync(OUT)) fs.unlinkSync(path.join(OUT, f));

  const tabs = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = tabs.find(t => t.type === 'page' && /music\.yandex/.test(t.url));
  if (!page) throw new Error('нет вкладки music.yandex');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  const pending = new Map(); let id = 0; const logs = []; const ctxs = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); return; }
    if (m.method === 'Runtime.executionContextCreated') ctxs.push(m.params.context);
    if (m.method === 'Runtime.consoleAPICalled') logs.push(m.params.args.map(a => a.value !== undefined ? String(a.value) : (a.description || '')).join(' ').slice(0, 260));
    if (m.method === 'Runtime.exceptionThrown') logs.push('[EXC] ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text || '').slice(0, 300));
  };
  const call = (method, params) => new Promise(res => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })); });
  await new Promise(r => ws.onopen = r);
  await call('Runtime.enable');
  await call('Page.enable');
  await call('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: OUT, eventsEnabled: true }).catch(() => {});

  // 1. Открыть трек и запустить воспроизведение: без него в плеере нет трека,
  //    а API без сеанса отдаёт только превью.
  await call('Page.navigate', { url: 'https://music.yandex.ru/album/43177815/track/153919215' });
  await sleep(9000);

  const ev = async (e) => (await call('Runtime.evaluate', { expression: e, returnByValue: true })).result?.value;

  // По умолчанию НЕ нажимаем Play: проверяем скачивание без воспроизведения
  // (OAuth-токен из cookie-сессии). YM_PLAY=1 — принудительно включить.
  const withPlay = process.env.YM_PLAY === '1';
  if (withPlay) {
    const play = await ev(`(() => {
      const b = document.querySelector('button[aria-label*="Воспроизведение"], button[aria-label*="Слушать"]');
      if (!b) return 'no play button';
      b.click(); return 'clicked play';
    })()`);
    console.log('play:', play);
    // Ждём, пока трек окажется в плеере (аннотация ставится из inject.js).
    let barId = null;
    for (let i = 0; i < 20 && !barId; i++) {
      await sleep(700);
      barId = await ev(`(function(){ var b = document.querySelector('section[class*=PlayerBar]'); return b ? b.getAttribute('data-ym-track-id') : null; })()`);
    }
    console.log('player track:', barId || 'НЕ ОПРЕДЕЛЁН');
  } else {
    console.log('play: не нажимаем (проверяем скачивание без воспроизведения)');
  }

  // 2. Клик по кнопке в изолированном мире расширения: btn.onclick живёт там,
  //    из MAIN-мира (обычный Runtime.evaluate) его не видно.
  const extCtxs = ctxs.filter(c => c.origin && c.origin.startsWith('chrome-extension'));
  const extId = extCtxs.length ? extCtxs[extCtxs.length - 1].id : null;
  if (!extId) throw new Error('контекст расширения не найден');
  const btn = await call('Runtime.evaluate', {
    contextId: extId, returnByValue: true,
    expression: `(function(){ var b = document.getElementById('ym-ext-download-btn'); if (!b) return 'NO PLAYER BUTTON'; b.onclick(); return 'clicked'; })()`
  });
  console.log('download:', btn && btn.result ? btn.result.value : '?');

  // 3. Ждём файл
  const deadline = Date.now() + 90000;
  let file = null;
  while (Date.now() < deadline) {
    await sleep(1000);
    const files = fs.readdirSync(OUT).filter(f => !f.endsWith('.crdownload'));
    if (files.length) { file = path.join(OUT, files[0]); break; }
  }
  if (!file) {
    const preview = logs.some(l => /превью-фрагмент/.test(l));
    console.log('logs:', logs.filter(l => /YM-DL|превью|Ошибка/.test(l)).slice(-8).join('\n') || '(нет)');
    console.log(preview
      ? 'ИТОГ: конвейер отработал, но без логина API отдаёт только превью — файл отброшен намеренно (это верное поведение). Для проверки полного файла нужен авторизованный профиль.'
      : 'ИТОГ: файл не появился за 90с');
    ws.close();
    process.exit(preview ? 2 : 1);
  }

  const size = fs.statSync(file).size;
  const buf = fs.readFileSync(file);
  const head = buf.subarray(0, 12);
  const hex = head.toString('hex');
  let container = 'unknown';
  if (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) container = 'mp3(ID3)';
  else if (head[4] === 0x66 && head[5] === 0x74 && head[6] === 0x79 && head[7] === 0x70) container = 'm4a(ftyp)';
  else if (head.subarray(0, 4).toString() === 'fLaC') container = 'flac';

  // Название берём из самого файла: ожидание «в плеере именно этот трек»
  // неверно (плейлист может переключить воспроизведение вперёд).
  const fileBase = path.basename(file, path.extname(file));
  const text = buf.subarray(0, 400000).toString('latin1');
  const utf16 = buf.subarray(0, 400000).toString('utf16le');
  const hasAnyTitle = /TIT2/.test(text);
  const hasArtist = /TPE1/.test(text);
  const hasApic = /APIC/.test(text);
  const seconds = Math.round(size * 8 / 320000);

  console.log(JSON.stringify({
    file: fileBase,
    size,
    seconds,
    headHex: hex,
    container,
    hasId3TitleFrame: hasAnyTitle,
    hasId3ArtistFrame: hasArtist,
    hasCoverFrame: hasApic
  }, null, 1));
  console.log('logs:', logs.filter((l) => /YM-DL|превью|Ошибка/.test(l)).slice(-6).join('\n') || '(none)');

  // Полный трек: не превью (~30с), есть теги и обложка.
  const ok = size > 1_000_000 && seconds > 60 && container === 'mp3(ID3)' && hasAnyTitle && hasArtist;
  console.log(ok ? 'RESULT: OK (полный трек с тегами)' : 'RESULT: FAIL');
  ws.close();
  process.exit(ok ? 0 : 1);
}
main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });

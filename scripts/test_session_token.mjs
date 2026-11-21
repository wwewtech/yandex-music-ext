/**
 * Офлайн-проверка OAuth-обмена sessionid -> токен -> полный трек.
 * Браузер не нужен, нужен только Session_id (передаётся файлом кук).
 *
 * Запуск:
 *   node scripts/test_session_token.mjs --cookies cookies.json
 *   node scripts/test_session_token.mjs --session "<Session_id>"
 *
 * cookies.json — массив [{name, value}] (как отдаёт CDP Network.getCookies).
 * Проверяет: токен выдаётся, download-info отдаёт preview=false, байты качаются.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';

const CLIENT_ID = '23cabbbdc6cd418abb4b39c32c41195d';
const CLIENT_SECRET = '53bc75238f0c4d08a118e51fe9203300';
const SALT = 'XGRlBW9FXlekgbPrRHuSiA';
const TRACK = process.env.YM_TRACK || '153919215';

function arg(name) {
  const i = process.argv.indexOf('--' + name);
  return i === -1 ? null : process.argv[i + 1];
}

function fail(msg) { console.error('[FAIL]', msg); process.exit(1); }
function ok(msg) { console.log('[OK]', msg); }

const cookiesFile = arg('cookies');
const session = arg('session');
let cookieHeader = '';
if (cookieHeader === '' && cookiesFile) {
  const cookies = JSON.parse(fs.readFileSync(cookiesFile, 'utf8'));
  cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
} else if (session) {
  cookieHeader = `Session_id=${session}`;
}
if (!cookieHeader) fail('нужен --cookies <file> или --session <Session_id>');

// 1. Обмен
const res = await fetch('https://oauth.yandex.ru/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookieHeader },
  body: new URLSearchParams({
    grant_type: 'sessionid', client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET, host: 'oauth.yandex.ru'
  })
});
const bodyText = await res.text();
if (res.status === 401 || res.status === 400) fail(`обмен отклонён (${res.status}): ${bodyText.slice(0, 160)} — вероятно, сессия протухла`);
if (!res.ok) fail(`обмен HTTP ${res.status}: ${bodyText.slice(0, 160)}`);
const token = JSON.parse(bodyText).access_token;
if (!token) fail('в ответе нет access_token');
ok(`сессия обменяна на токен (${token.length} симв., 200)`);

// 2. download-info ТОЛЬКО с токеном (без воспроизведения)
const di = await fetch(`https://api.music.yandex.net/tracks/${TRACK}/download-info`, {
  headers: { Authorization: 'OAuth ' + token }
});
const dj = await di.json();
if (di.status !== 200) fail(`download-info HTTP ${di.status}: ${JSON.stringify(dj).slice(0, 140)}`);
const items = dj.result || [];
const full = items.filter((i) => !i.preview);
if (!full.length) fail(`все варианты — превью: ${JSON.stringify(items.map((i) => i.codec + '/' + i.preview))}`);
ok(`download-info отдаёт полный трек: ${full.length} вариантов, лучший ${full[0].codec}/${full[0].bitrateInKbps}kbps`);

// 3. Байты
const pick = full.sort((a, b) => b.bitrateInKbps - a.bitrateInKbps)[0];
const xml = await (await fetch(pick.downloadInfoUrl + '&format=json', { headers: { Authorization: 'OAuth ' + token } })).text();
const info = JSON.parse(xml);
const sign = crypto.createHash('md5').update(SALT + info.path.substring(1) + info.s).digest('hex');
const audio = await fetch(`https://${info.host}/get-mp3/${sign}/${info.ts}${info.path}`);
const buf = Buffer.from(await audio.arrayBuffer());
if (audio.status !== 200) fail('аудио HTTP ' + audio.status);
if (buf.length < 1_000_000) fail(`файл слишком мал (${buf.length}) — похоже на превью`);
const sec = Math.round((buf.length * 8) / (pick.bitrateInKbps * 1000));
if (sec < 60) fail(`слишком коротко: ~${sec}с`);

ok(`аудио скачано: ${buf.length} байт, ~${sec}с, ${pick.bitrateInKbps}kbps — полный трек`);
console.log('\nALL SESSION-TOKEN TESTS PASSED');

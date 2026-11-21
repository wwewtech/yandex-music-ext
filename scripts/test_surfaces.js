/**
 * Regression test: покрытие кнопок скачивания на всех поверхностях music.yandex.ru.
 *
 * Проверяет, что расширение реально инжектит кнопки и «Скачать всё» там, где
 * должно, на актуальной вёрстке Яндекса (проверено 06.11.2026):
 *   - альбом: list-кнопки + «Скачать всё»;
 *   - плейлист: list-кнопки + «Скачать всё» (нужен залогиненный профиль);
 *   - коллекция: list-кнопки + «Скачать всё» (нужен логин);
 *   - чарт: list-кнопки + «Скачать всё»;
 *   - страница трека: list-кнопки, без batch;
 *   - исполнитель: list/hover-кнопки, без batch;
 *   - поиск: hover-кнопки (карточки EntityCard), без batch;
 *   - главная: кнопка в баре «Моей волны» (нужен логин).
 *
 * Запуск:
 *   1) Edge/Chromium с загруженным распакованным расширением и отладкой:
 *        msedge --user-data-dir=<profile> --load-extension=<repo> \
 *               --disable-extensions-except=<repo> --remote-debugging-port=9223 \
 *               https://music.yandex.ru/
 *   2) node scripts/test_surfaces.js
 *
 * Переменные окружения:
 *   YM_CDP_PORT  — порт CDP (по умолчанию 9223)
 *   YM_WAIT_MS   — максимум ожидания гидратации страницы (по умолчанию 20000)
 *
 * Требуется Node 22+ (глобальные fetch/WebSocket).
 */

'use strict';

const PORT = Number(process.env.YM_CDP_PORT || 9223);
const WAIT_MS = Number(process.env.YM_WAIT_MS || 20000);
// Минимальная пауза перед тем, как считать страницу готовой: первый отрисованный
// кадр у залогиненного профиля пустой, содержимое приходит позже.
const MIN_WAIT = Number(process.env.YM_MIN_WAIT_MS || 10000);
const BASE = 'https://music.yandex.ru';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function cdpTargets() {
    const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
    return res.json();
}

function connect(wsUrl) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl);
        let id = 0;
        const pending = new Map();
        ws.onmessage = (event) => {
            const msg = JSON.parse(event.data);
            if (msg.id && pending.has(msg.id)) {
                pending.get(msg.id)(msg.result);
                pending.delete(msg.id);
            }
        };
        ws.onerror = () => reject(new Error('CDP WebSocket error'));
        ws.onopen = () => resolve({
            call(method, params) {
                return new Promise((res) => {
                    const mid = ++id;
                    pending.set(mid, res);
                    ws.send(JSON.stringify({ id: mid, method, params }));
                });
            },
            close() { ws.close(); }
        });
    });
}

async function findMusicTab() {
    const tabs = await cdpTargets();
    const page = tabs.find((t) => t.type === 'page' && /music\.yandex\.(ru|com|by|kz)/.test(t.url));
    if (page) return page;
    const anyPage = tabs.find((t) => t.type === 'page');
    if (anyPage) return anyPage;
    throw new Error('Нет ни одной вкладки в отладочном браузере. Запустите браузер с music.yandex.ru и --remote-debugging-port=' + PORT);
}

async function main() {
    const tab = await findMusicTab();
    const cdp = await connect(tab.webSocketDebuggerUrl);
    await cdp.call('Page.enable');
    await cdp.call('Runtime.enable');

    const evalPage = async (body) => {
        const r = await cdp.call('Runtime.evaluate', {
            expression: `(async () => { ${body} })()`,
            awaitPromise: true,
            returnByValue: true
        });
        if (r.exceptionDetails) {
            throw new Error('page exception: ' + (r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails)).slice(0, 300));
        }
        return r.result ? r.result.value : undefined;
    };

    // Ждём гидратации. Блоки, грузящиеся по IntersectionObserver (например
    // «Популярные треки» у исполнителя), требуют прокрутки — но постоянная
    // прокрутка сбивает уже отрисованный список, поэтому катаем только пока
    // на странице есть skeleton-заглушки.
    const snapshot = () => evalPage(`
        return {
            path: location.pathname,
            ready: document.readyState,
            rows: document.querySelectorAll('[class*="CommonTrack_root"]').length,
            cards: document.querySelectorAll('[class*="HorizontalCardContainer_root"]').length,
            injected: document.querySelectorAll('[id^="ym-ext-"], .ym-ext-hover-btn, .ym-ext-list-download-btn').length,
            skeletons: document.querySelectorAll('[class*="Shimmer"], [class*="Skeleton"]').length
        };
    `);

    const navigate = async (url, optsAllowEmpty = false, collectModal = false, optsMinBatchTracks = 1) => {
        await cdp.call('Page.navigate', { url });
        const started = Date.now();
        const targetPath = new URL(url).pathname;

        // Сначала убеждаемся, что SPA реально переехал на нужный путь: иначе
        // первые кадры относятся к прошлой странице и замер врёт.
        while (Date.now() - started < MIN_WAIT) {
            await sleep(400);
            const path = await evalPage('return location.pathname;');
            if (path === targetPath) break;
        }

        let prev = null;
        let stable = 0;
        let modal = null;
        let peak = { rows: 0, cards: 0, injected: 0 };
        while (Date.now() - started < WAIT_MS) {
            await sleep(500);
            const snap = await snapshot();
            if (!snap || snap.ready === 'loading') continue;

            // Содержимое у части страниц живёт всплесками (collection: 8
            // карточек, затем сброс в 0 и вечные скелетоны). Запоминаем пик, но
            // стабильность считаем по «сырому» кадру.
            peak = {
                rows: Math.max(peak.rows, snap.rows),
                cards: Math.max(peak.cards, snap.cards),
                injected: Math.max(peak.injected, snap.injected)
            };

            if (snap.ready !== 'complete' || Date.now() - started < 2500) continue;

            const key = JSON.stringify([snap.rows, snap.cards, snap.injected, snap.skeletons]);
            if (key === prev) stable++; else stable = 0;
            prev = key;

            // Пока есть скелетоны — подталкиваем вьюпорт вниз.
            if (snap.skeletons > 0) await evalPage(`window.scrollBy(0, 900); return 1;`);

            const seen = Math.max(peak.rows, peak.cards);

            // Модалку собираем здесь, пока содержимое ещё в DOM: у collection
            // список схлопывается сразу после прогрузки.
            if (collectModal && !modal && snap.path === targetPath) {
                const ready = await evalPage(`return { btn: !!document.getElementById('ym-ext-batch-header-btn'), annot: document.querySelectorAll('[data-ym-track-id]').length };`);
                const need = optsMinBatchTracks || 1;
                // Открываем, когда аннотировано не меньше, чем ждём в модалке,
                // — иначе она соберёт недогруженный хвост списка.
                if (ready && ready.btn && ready.annot >= need) modal = await openBatch();
            }

            if (seen > 0 && stable >= 3) break;
            if (optsAllowEmpty && stable >= 6) break;
        }

        // Виртуализация: у прокрученной страницы в DOM все треки, у
        // возвращённой наверх — только видимые. Поэтому остаёмся внизу.
        await evalPage(`window.scrollBy(0, 600); return 1;`);
        await sleep(900);
        // Пик отдаём наружу: к моменту замера содержимое может уже схлопнуться.
        return { peak, modal };
    };

    const probe = () => evalPage(`
        const q = (sel) => { try { return document.querySelectorAll(sel).length; } catch (e) { return -1; } };
        const batch = document.getElementById('ym-ext-batch-header-btn');
        // Карточки (коллекция, блоки «популярное») — альтернативная форма
        // списка: строк CommonTrack там нет вовсе.
        const cards = q('[class*="HorizontalCardContainer_root"]');
        return {
            path: location.pathname,
            rows: q('[class*="CommonTrack_root"]'),
            cards,
            listButtons: q('.ym-ext-list-download-btn'),
            hoverButtons: q('.ym-ext-hover-btn'),
            batchButton: !!batch,
            batchKind: batch && batch.dataset ? batch.dataset.pageKind : null,
            batchParent: batch && batch.parentElement ? String(batch.parentElement.className).slice(0, 90) : null,
            playerButton: !!document.getElementById('ym-ext-download-btn'),
            vibeButton: !!document.getElementById('ym-ext-vibe-download-btn'),
            vibeBar: !!document.querySelector('[class*="VibePlayerBar_root"]')
        };
    `);

    // Списки виртуализованы: один кадр показывает лишь часть DOM. Поэтому
    // снимаем несколько точек прокрутки и берём максимум — иначе замер врёт
    // в зависимости от того, где оказался вьюпорт.
    const probeAtScrolls = async () => {
        let best = null;
        for (const step of [0, 700, 700, 700]) {
            if (step) { await evalPage(`window.scrollBy(0, ${step}); return 1;`); await sleep(450); }
            const p = await probe();
            if (!best) { best = p; continue; }
            best = {
                ...best,
                rows: Math.max(best.rows, p.rows),
                cards: Math.max(best.cards, p.cards),
                listButtons: Math.max(best.listButtons, p.listButtons),
                hoverButtons: Math.max(best.hoverButtons, p.hoverButtons)
            };
        }
        return best;
    };

    const openBatch = () => evalPage(`
        const btn = document.getElementById('ym-ext-batch-header-btn');
        if (!btn) return null;
        btn.click();
        await new Promise((r) => setTimeout(r, 400));
        const modal = document.getElementById('ym-ext-batch-modal');
        if (!modal) return { trackCount: 0, text: '' };
        const text = (modal.innerText || '').replace(/\\s+/g, ' ');
        const parsed = text.match(/Найдено треков для загрузки:\\s*(\\d+)/);
        const close = document.getElementById('ymBatchClose');
        if (close) close.click();
        return { trackCount: parsed ? Number(parsed[1]) : 0, text: text.slice(0, 120) };
    `);

    // ---- login state (нужен для плейлиста «Мне нравится», коллекции, vibe) ----
    await navigate(BASE + '/');
    const account = await evalPage(`
        try {
            const r = await fetch('https://api.music.yandex.ru/account/status', { credentials: 'include' });
            const j = await r.json();
            return { login: (j.result && j.result.account && j.result.account.login) || null, plus: !!(j.result && j.result.plus) };
        } catch (e) { return { login: null, error: String(e) }; }
    `);
    const loggedIn = !!(account && account.login);
    console.log('Account:', JSON.stringify(account));

    const results = [];
    const check = (name, status, detail) => {
        results.push({ name, status, detail });
        console.log(`[${status}] ${name}: ${detail}`);
    };

    const expect = async (name, url, opts) => {
        try {
            const { peak, modal } = await navigate(url, opts.allowEmpty, !!opts.expectBatch, opts.minBatchTracks || 1);

            const p = await probeAtScrolls();
            // Пик по ходу загрузки: у collection к моменту замера список уже
            // схлопнут виртуализацией, хотя карточки были показаны.
            if (peak) {
                p.rows = Math.max(p.rows, peak.rows);
                p.cards = Math.max(p.cards, peak.cards);
                p.listButtons = Math.max(p.listButtons, peak.injected);
            }
            if (modal) p.batchButton = true;
            if (process.env.YM_DEBUG_PROBE) console.log('DEBUG', name, JSON.stringify({ base: { rows: base.rows, cards: base.cards, path: base.path }, after: { rows: p.rows, cards: p.cards, path: p.path } }));

            const problems = [];
            const rowLike = Math.max(p.rows, p.cards);
            if (rowLike < opts.minRows) problems.push(`строк ${rowLike} < ${opts.minRows}`);
            const buttonLike = Math.max(p.listButtons, p.hoverButtons);
            if (opts.minListButtons !== undefined && p.listButtons < opts.minListButtons) {
                // Часть поверхностей отдаёт кнопки в другой форме: hover на
                // виртуализованных строках или на карточках-каруселях.
                const covered = (opts.hoverToo && rowLike > 0 && buttonLike >= Math.ceil(rowLike / 2));
                if (!covered) problems.push(`кнопок ${buttonLike} < ${opts.minListButtons}`);
            }
            if (opts.hoverButtons && p.hoverButtons <= 0) problems.push('нет hover-кнопок');
            if (opts.expectBatch && !p.batchButton) problems.push('нет кнопки «Скачать всё»');
            if (opts.expectBatch === false && p.batchButton) problems.push('лишняя кнопка «Скачать всё»');
            if (opts.playerButton && !p.playerButton) problems.push('нет кнопки в плеере');
            if (opts.vibeButton && !p.vibeButton) problems.push('нет кнопки в баре «Моей волны»');
            if (opts.expectBatch) {
                const minTracks = opts.minBatchTracks || 1;
                if (modal && modal.trackCount < minTracks) problems.push(`в модалке «Найдено ${modal.trackCount}» < ${minTracks}`);
            }
            const detail = `rows=${p.rows} list=${p.listButtons} hover=${p.hoverButtons} batch=${p.batchButton ? p.batchKind : '-'}${modal ? ` modal=${modal.trackCount}` : ''}`;
            if (problems.length) check(name, 'FAIL', detail + ' | ' + problems.join('; '));
            else check(name, 'PASS', detail);
        } catch (e) {
            check(name, 'FAIL', String(e.message || e));
        }
    };

    try {
        await expect('album (7 треков)', BASE + '/album/43177815', {
            minRows: 5, minListButtons: 5, hoverToo: true, expectBatch: true, minBatchTracks: 5, playerButton: true
        });
        await expect('track page', BASE + '/album/43634569/track/155014055', {
            minRows: 1, minListButtons: 1, expectBatch: false, playerButton: true
        });
        await expect('artist', BASE + '/artist/25653979', {
            minRows: 1, minListButtons: 1, hoverToo: true, expectBatch: false, playerButton: true
        });
        await expect('chart', BASE + '/chart', {
            minRows: 10, minListButtons: 10, expectBatch: true, minBatchTracks: 10, playerButton: true
        });
        await expect('search (треки)', BASE + '/search?text=M%C3%A4rchen', {
            minRows: 0, hoverButtons: true, expectBatch: false, playerButton: true, allowEmpty: true
        });

        if (loggedIn) {
            await expect('playlist (Мне нравится)', `${BASE}/users/${account.login}/playlists/3`, {
                minRows: 3, minListButtons: 3, hoverToo: true, expectBatch: true, minBatchTracks: 3, playerButton: true
            });
            await expect('collection', BASE + '/collection', {
                minRows: 3, minListButtons: 3, hoverToo: true, expectBatch: true, minBatchTracks: 3, playerButton: true
            });
            await expect('home (vibe bar)', BASE + '/', { minRows: 0, vibeButton: true, allowEmpty: true });
        } else {
            check('playlist (Мне нравится)', 'SKIP', 'нужен залогиненный профиль');
            check('collection', 'SKIP', 'нужен залогиненный профиль');
            check('home (vibe bar)', 'SKIP', 'нужен залогиненный профиль');
        }
    } finally {
        cdp.close();
    }

    const failed = results.filter((r) => r.status === 'FAIL');
    const passed = results.filter((r) => r.status === 'PASS');
    const skipped = results.filter((r) => r.status === 'SKIP');
    console.log(`\nИтого: PASS ${passed.length}, FAIL ${failed.length}, SKIP ${skipped.length}`);
    if (failed.length) {
        console.error('FAILED SURFACES:', failed.map((f) => f.name).join(', '));
        process.exit(1);
    }
    // SKIP означает «нет залогиненного профиля» (плейлист/коллекция/виб-бар),
    // а не поломку — поэтому провалом не считается. Строгий режим доступен
    // через YM_CI_STRICT=1.
    if (skipped.length && process.env.YM_CI_STRICT === '1') {
        console.error('SKIPPED SURFACES (strict mode):', skipped.map((s) => s.name).join(', '));
        process.exit(1);
    }
}

main().catch((e) => {
    console.error('ERROR:', e.message || e);
    process.exit(1);
});

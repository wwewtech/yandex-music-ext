const SALT = 'XGRlBW9FXlekgbPrRHuSiA'; // Соль, идентичная той, что в Python библиотеке

// Функция получения прямой ссылки
async function getDownloadUrl(trackId, albumId) {
    // 1. Получаем инфо о треке из внутреннего WEB API Яндекс Музыки (токен не нужен, берет cookie браузера)
    const trackApiUrl = `https://music.yandex.ru/api/v2.1/handlers/track/${trackId}:${albumId}/web-album_track-track-track-main/download/m?hq=1`;
    const res1 = await fetch(trackApiUrl, {
        headers: { 'X-Retpath-Y': encodeURIComponent(location.href) }
    });
    const data1 = await res1.json();

    // 2. Получаем параметры сервера хранения (добавляем format=json, чтобы не парсить XML как в Python)
    const srcUrl = data1.src + '&format=json';
    const res2 = await fetch(srcUrl);
    const data2 = await res2.json();

    // 3. Формируем MD5 подпись (sign)
    const { host, path, ts, s } = data2;
    const sign = md5(SALT + path.substring(1) + s);

    // 4. Собираем итоговую ссылку
    return `https://${host}/get-mp3/${sign}/${ts}${path}`;
}

// Универсальная функция скачивания трека с добавлением метаданных (ID3 тегов)
async function downloadTrackWithMetadata(trackId, albumId, fallbackTitle, btnElement) {
    try {
        btnElement.style.opacity = '0.3';
        
        // 1. Получаем полные метаданные трека из API Яндекса
        const metaRes = await fetch(`https://music.yandex.ru/api/v2.1/handlers/tracks?tracks=${trackId}:${albumId}`);
        const metaData = await metaRes.json();
        const trackInfo = metaData[0];
        
        let title = fallbackTitle || 'track';
        let artists = '';
        let album = '';
        let year = '';
        let coverUrl = '';

        if (trackInfo) {
            title = trackInfo.title || title;
            if (trackInfo.artists && trackInfo.artists.length > 0) {
                artists = trackInfo.artists.map(a => a.name).join(', ');
            }
            if (trackInfo.albums && trackInfo.albums.length > 0) {
                album = trackInfo.albums[0].title || '';
                year = trackInfo.albums[0].year || '';
            }
            if (trackInfo.coverUri) {
                coverUrl = `https://${trackInfo.coverUri.replace('%%', '400x400')}`;
            }
        }
        
        const fileName = (artists ? `${artists} - ${title}` : title).replace(/[\\/:*?"<>|]/g, "_");

        // 2. Получаем прямую ссылку на mp3
        const downloadUrl = await getDownloadUrl(trackId, albumId);
        
        // 3. Скачиваем MP3 в память браузера (как ArrayBuffer)
        const mp3Res = await fetch(downloadUrl);
        const mp3Buffer = await mp3Res.arrayBuffer();
        
        // 4. Скачиваем обложку (если она есть) для добавления в трек
        let coverBuffer = null;
        if (coverUrl) {
            try {
                const coverRes = await fetch(coverUrl);
                coverBuffer = await coverRes.arrayBuffer();
            } catch(e) {
                console.warn('Не удалось скачать обложку', e);
            }
        }
        
        // 5. Записываем ID3 теги с помощью скрипта id3-writer.js
        const writer = new window.ID3Writer(mp3Buffer);
        writer.addTextFrame('TIT2', title);
        if (artists) writer.addTextFrame('TPE1', artists);
        if (album) writer.addTextFrame('TALB', album);
        if (year) writer.addTextFrame('TYER', year.toString());
        if (coverBuffer) writer.addPictureFrame(coverBuffer, 'image/jpeg');
        
        const taggedBuffer = writer.getTaggedBuffer();
        const blob = new Blob([taggedBuffer], { type: 'audio/mp3' });
        const blobUrl = URL.createObjectURL(blob);

        // 6. Отправляем временную ссылку (blob URL) в фоновый скрипт
        chrome.runtime.sendMessage({ 
            action: 'download', 
            url: blobUrl, 
            filename: fileName 
        });
        
        // Очищаем память, удаляя временную blob ссылку через минуту
        setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);

    } catch (e) {
        console.error("Ошибка при получении и записи метаданных трека:", e);
        alert("Не удалось скачать трек с тегами. Проверьте консоль.");
    } finally {
        btnElement.style.opacity = '1';
    }
}

// Функция добавления кнопки в плеер
function injectDownloadButton() {
    if (document.getElementById('ym-ext-download-btn')) return;

    // Пытаемся найти панель плеера или элемент, куда можно вставить кнопку (например, рядом с кнопкой лайка)
    let targetContainer = null;
    let insertMethod = 'append'; // 'append' или 'after'
    
    // 1. Полноценная панель (старые и новые классы)
    targetContainer = document.querySelector('.PlayerBarDesktopWithBackgroundProgressBar_sonata__mGFb_') || 
                      document.querySelector('[class*="PlayerBar"] [class*="sonata"]');
                      
    if (!targetContainer) {
        // 2. Фолбэк: ищем кнопку "Мне нравится" (Лайк) в плеере и ставим нашу кнопку рядом
        // Плеер обычно либо внизу, либо имеет класс player
        const likeBtn = document.querySelector('[class*="Player"] button[aria-label="Мне нравится"], [class*="Player"] button[title="Мне нравится"], [class*="player"] button[aria-label="Like"]');
        if (likeBtn && likeBtn.parentNode) {
            targetContainer = likeBtn;
            insertMethod = 'after';
        }
    }
    
    if (!targetContainer) return;

    const btn = document.createElement('button');
    btn.id = 'ym-ext-download-btn';
    // Используем максимально нейтральный и общий стиль, или копируем с соседних элементов
    btn.className = 'cpeagBA1_PblpJn8Xgtv UDMYhpDjiAFT3xUx268O uwk3hfWzB2VT7kE13SQk IlG7b1K0AD7E7AMx6F5p HbaqudSqu7Q3mv3zMPGr WtFdWDF44egSVM_YiMUX qU2apWBO1yyEK0lZ3lPO';
    btn.setAttribute('aria-label', 'Скачать трек');
    btn.setAttribute('title', 'Скачать трек');
    btn.style.marginLeft = '12px';
    btn.style.marginRight = '12px';
    btn.style.cursor = 'pointer';
    btn.style.display = 'inline-flex';
    btn.style.alignItems = 'center';
    btn.style.justifyContent = 'center';
    btn.style.background = 'transparent';
    btn.style.border = 'none';
    btn.style.color = 'inherit';

    btn.innerHTML = `
        <span class="JjlbHZ4FaP9EAcR_1DxF" style="display:flex; align-items:center;">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
            </svg>
        </span>
    `;

    btn.onclick = async () => {
        // Ищем ссылку на трек. Поскольку классы меняются, мы просматриваем все ссылки внутри блока плеера, 
        // содержащие одновременно /album/ и /track/
        // Ограничиваем поиск родительским контейнером всего плеера (например, header, footer или div с [class*="Player"])
        const playerArea = document.querySelector('[class*="PlayerBar"]') || document.querySelector('[class*="player"]') || document.body;
        
        // Получаем все ссылки на треки в области плеера
        const trackLinks = Array.from(playerArea.querySelectorAll('a[href*="/album/"][href*="/track/"]'));
        
        // Первая ссылка обычно и есть название трека
        const trackLink = trackLinks.find(a => {
            const match = a.getAttribute('href').match(/\/album\/(\d+)\/track\/(\d+)/);
            // Исключаем ссылки на комментарии и т.д.
            return match && match[1] && match[2] && a.textContent.trim().length > 0;
        });
        
        if (!trackLink) {
            alert("Не удалось определить играющий трек. Возможно, не открыт плеер или изменился дизайн Я.Музыки.");
            return;
        }

        const match = trackLink.getAttribute('href').match(/\/album\/(\d+)\/track\/(\d+)/);
        const albumId = match[1];
        const trackId = match[2];
        
        // Ищем ссылки на артистов. Они обычно рядом с названием трека в том же родительском блоке, и содержат /artist/
        const trackContainer = trackLink.closest('[class*="description"]') || trackLink.closest('[class*="track-info"]') || trackLink.parentNode.parentNode;
        let artists = '';
        if (trackContainer) {
            const artistLinks = trackContainer.querySelectorAll('a[href*="/artist/"]');
            artists = Array.from(artistLinks).map(a => a.textContent.trim()).join(', ');
        }

        const trackTitle = trackLink.textContent.trim();

        // Отправляем на скачивание (внутри функции название дополнится и обновятся теги)
        await downloadTrackWithMetadata(trackId, albumId, trackTitle, btn);
    };

    if (insertMethod === 'append') {
        targetContainer.appendChild(btn);
    } else if (insertMethod === 'after' && targetContainer.parentNode) {
        targetContainer.parentNode.insertBefore(btn, targetContainer.nextSibling);
    }
}

// Функция добавления кнопок в списки треков (в альбомах, плейлистах и т.д.)
function injectListDownloadButtons() {
    // Ищем все строки с треками (обычно это элементы с классом, содержащим 'CommonTrack_root' или 'TrackPlaylist_track')
    const trackRows = document.querySelectorAll('[class*="CommonTrack_root"], [class*="TrackPlaylist_track"], [class*="d-track "], .d-track');

    trackRows.forEach(row => {
        // Проверяем, добавили ли мы уже кнопку в этот трек
        if (row.querySelector('.ym-ext-list-download-btn')) return;

        // Находим контейнер с контролами (где лайк и время)
        const controlsBar = row.querySelector('[class*="CommonControlsBar_controls"], [class*="TrackPlaylist_controlsBarCell"], .d-track__actions');
        if (!controlsBar) return;

        // Пытаемся найти ссылку на трек внутри этой строки
        const trackLink = row.querySelector('a[href*="/album/"][href*="/track/"]');
        if (!trackLink) return;

        const match = trackLink.getAttribute('href').match(/\/album\/(\d+)\/track\/(\d+)/);
        if (!match) return;

        const albumId = match[1];
        const trackId = match[2];

        // Создаем маленькую кнопку скачивания
        const btn = document.createElement('button');
        btn.className = 'ym-ext-list-download-btn cpeagBA1_PblpJn8Xgtv UDMYhpDjiAFT3xUx268O zIMibMuH7wcqUoW7KH1B IlG7b1K0AD7E7AMx6F5p HbaqudSqu7Q3mv3zMPGr j1jXIVckFgZECecFzZMe qU2apWBO1yyEK0lZ3lPO CommonControlsBar_item__qGErG';
        btn.setAttribute('aria-label', 'Скачать трек');
        btn.setAttribute('title', 'Скачать трек');
        
        // Нейтральные стили, с подстройкой под контекст списков
        btn.style.cursor = 'pointer';
        btn.style.display = 'inline-flex';
        btn.style.alignItems = 'center';
        btn.style.justifyContent = 'center';
        btn.style.background = 'transparent';
        btn.style.border = 'none';
        btn.style.color = 'inherit';
        btn.style.padding = '0 8px';
        btn.style.opacity = '0.7';

        // Иконка
        btn.innerHTML = `
            <span class="JjlbHZ4FaP9EAcR_1DxF">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
                </svg>
            </span>
        `;

        // Немного магии со стилями по наведению
        btn.onmouseover = () => btn.style.opacity = '1';
        btn.onmouseout = () => btn.style.opacity = '0.7';

        btn.onclick = async (e) => {
            e.preventDefault();
            e.stopPropagation();

            const trackTitle = trackLink.textContent.trim() || row.getAttribute('aria-label') || 'track';
            
            // Вызываем общую функцию со вшитыми тегами
            await downloadTrackWithMetadata(trackId, albumId, trackTitle, btn);
        };

        // Вставляем перед первым дочерним элементом в controlsBar (обычно перед лайком)
        if (controlsBar.firstChild) {
            controlsBar.insertBefore(btn, controlsBar.firstChild);
        } else {
            controlsBar.appendChild(btn);
        }
    });
}

// Яндекс Музыка работает как SPA (Single Page Application), элементы подгружаются динамически.
// Используем MutationObserver чтобы следить за появлением/изменением плеера.
const observer = new MutationObserver(() => {
    injectDownloadButton();
    injectListDownloadButtons();
});

observer.observe(document.body, { childList: true, subtree: true });
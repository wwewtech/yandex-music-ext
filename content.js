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

// Функция добавления кнопки в плеер
function injectDownloadButton() {
    // Если кнопка уже есть — выходим
    if (document.getElementById('ym-ext-download-btn')) return;

    // Ищем зону панели плеера из вашего примера кода
    const playerBar = document.querySelector('.PlayerBarDesktopWithBackgroundProgressBar_sonata__mGFb_');
    if (!playerBar) return;

    // Создаем кнопку, копируя классы Яндекса (чтобы она выглядела идентично "лайку" или "дизлайку")
    const btn = document.createElement('button');
    btn.id = 'ym-ext-download-btn';
    // Классы взяты из кнопок управления плеером
    btn.className = 'cpeagBA1_PblpJn8Xgtv UDMYhpDjiAFT3xUx268O uwk3hfWzB2VT7kE13SQk IlG7b1K0AD7E7AMx6F5p HbaqudSqu7Q3mv3zMPGr WtFdWDF44egSVM_YiMUX qU2apWBO1yyEK0lZ3lPO';
    btn.setAttribute('aria-label', 'Скачать трек');
    btn.style.marginLeft = '12px'; // Небольшой отступ

    // SVG иконка скачивания
    btn.innerHTML = `
        <span class="JjlbHZ4FaP9EAcR_1DxF">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
            </svg>
        </span>
    `;

    // Логика по клику
    btn.onclick = async () => {
        // Ищем ссылку на текущий трек в панели плеера
        const trackLink = document.querySelector('.PlayerBarDesktopWithBackgroundProgressBar_description__5jHke a[href*="/track/"]');
        const artistLinks = document.querySelectorAll('.PlayerBarDesktopWithBackgroundProgressBar_description__5jHke .Meta_artists__VnR52 a');
        
        if (!trackLink) return;

        // Вытаскиваем albumId и trackId из href (пример: /album/41667153/track/150447734)
        const match = trackLink.getAttribute('href').match(/\/album\/(\d+)\/track\/(\d+)/);
        if (!match) return;

        const albumId = match[1];
        const trackId = match[2];
        
        // Формируем красивое название файла (Артист 1, Артист 2 - Название трека)
        const trackTitle = trackLink.textContent.trim();
        const artists = Array.from(artistLinks).map(a => a.textContent.trim()).join(', ');
        const fileName = artists ? `${artists} - ${trackTitle}` : trackTitle;

        try {
            // Анимация нажатия (полупрозрачность)
            btn.style.opacity = '0.5';
            
            const downloadUrl = await getDownloadUrl(trackId, albumId);
            
            // Отправляем ссылку в фоновый скрипт для начала скачивания
            chrome.runtime.sendMessage({ 
                action: 'download', 
                url: downloadUrl, 
                filename: fileName 
            });
            
        } catch (e) {
            console.error("Ошибка при получении ссылки на трек:", e);
            alert("Не удалось скачать трек. Проверьте консоль.");
        } finally {
            btn.style.opacity = '1';
        }
    };

    // Вставляем кнопку в конец блока с кнопками
    playerBar.appendChild(btn);
}

// Яндекс Музыка работает как SPA (Single Page Application), элементы подгружаются динамически.
// Используем MutationObserver чтобы следить за появлением/изменением плеера.
const observer = new MutationObserver(() => {
    injectDownloadButton();
});

observer.observe(document.body, { childList: true, subtree: true });
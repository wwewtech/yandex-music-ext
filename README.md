# 🎵 Yandex Music Downloader (Chrome Extension)

[![Manifest V3](https://img.shields.io/badge/Manifest-V3-success.svg?style=flat-square)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg?style=flat-square)](https://github.com/wwewtech/yandex-music-ext/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](LICENSE)
[![Platform](https://img.shields.io/badge/Browser-Chrome%20%7C%20Edge%20%7C%20Brave%20%7C%20Yandex-orange.svg?style=flat-square)](https://music.yandex.ru)

🎧 Легковесное расширение для браузеров на базе Chromium (Google Chrome, Microsoft Edge, Brave, Яндекс Браузер, Opera), добавляющее кнопку скачивания треков с **Яндекс Музыки** в наилучшем качестве (MP3 320 kbps) с полными метаданными и оригинальной обложкой альбома.

---

## ✨ Возможности

- 🚀 **Скачивание в 1 клик** — кнопки скачивания встроены как в главный плеер, так и в списки треков (альбомы, плейлисты, чарты, «Моя волна»).
- 🏷️ **ID3v2 метаданные** — автоматическое сохранение тегов:
  - Название трека (`TIT2`)
  - Исполнители (`TPE1`)
  - Название альбома (`TALB`)
  - Год выпуска (`TYER`)
- 🖼️ **Вшитая обложка альбома** — встраивает HQ обложку (400x400) прямо в MP3-файл (`APIC`). Треки отображаются с оригинальными обложками на любых устройствах (в авто, на смартфоне, в медиаплеерах).
- ⚡ **HQ качество** — скачивание аудиопотока в максимальном доступном качестве (320 kbps).
- 🛡️ **Manifest V3 & Чистый код** — современная архитектура Service Worker, отсутствие тяжелых фреймворков и внешних сборщиков.
- 🔒 **Приватность и безопасность** — работает через текущую активную сессию браузера, без сбора телеметрии и без передачи данных на сторонние серверы.

---

## 📥 Установка

### Вариант 1. Из готового релиза (Рекомендуется)

1. Перейдите на вкладку [**Releases**](https://github.com/wwewtech/yandex-music-ext/releases) и скачайте `yandex-music-downloader-v1.0.0.zip`.
2. Распакуйте архив в любую удобную папку на диске.
3. Откройте страницу расширений в вашем браузере:
   - **Google Chrome**: `chrome://extensions/`
   - **Яндекс Браузер**: `browser://extensions/`
   - **Microsoft Edge**: `edge://extensions/`
   - **Brave**: `brave://extensions/`
4. Включите переключатель **«Режим разработчика»** (Developer mode) в верхнем правом углу.
5. Нажмите кнопку **«Загрузить распакованное расширение»** (Load unpacked).
6. Выберите распакованную папку с файлами расширения.
7. Готово! Перейдите на [music.yandex.ru](https://music.yandex.ru) и обновите страницу.

---

### Вариант 2. Клонирование репозитория через Git

```bash
git clone https://github.com/wwewtech/yandex-music-ext.git
cd yandex-music-ext
```
Затем загрузите папку через `chrome://extensions/` аналогично инструкции выше.

---

## 🎧 Как пользоваться

1. Откройте [Яндекс Музыку](https://music.yandex.ru).
2. Запустите любой трек или откройте альбом / плейлист.
3. Нажмите на иконку скачивания:
   - В нижней панели плеера (рядом с кнопкой «Мне нравится»).
   - Либо в строке любого трека в списке.
4. Файл сохранится в папку «Загрузки» браузера с корректным именем: `Исполнитель - Название.mp3`.

---

## 📁 Структура проекта

```text
yandex_music_ext/
├── manifest.json       # Манифест расширения (Manifest V3)
├── background.js       # Background Service Worker (CORS-обход и управление скачиванием)
├── content.js          # Content script (инъекция кнопок в DOM, получение ссылок и тегов)
├── id3-writer.js       # Генератор ID3v2 тегов в бинарный MP3-буфер
├── md5.js              # Вычисление хэша MD5 для подписи запросов
├── icons/              # Иконки расширения (16x16, 32x32, 48x48, 128x128)
├── .gitignore          # Игнорируемые файлы Git
├── LICENSE             # Лицензия MIT
└── README.md           # Документация проекта
```

---

## 🛠️ Стек технологий

- **JavaScript (Vanilla ES6+)** — нативный JS без фреймворков и сборщиков.
- **Chrome Extension API** (`chrome.downloads`, `chrome.runtime`, `content_scripts`).
- **MutationObserver API** — динамическое отслеживание SPA-роутинга Яндекс Музыки.
- **ID3v2.3 Specification** — запись бинарных фреймов метаданных и JPEG обложек.

---

## ⚖️ Дисклеймер

Расширение создано исключительно в образовательных целях и для личного ознакомления. Все права на аудиоматериалы принадлежат их законным правообладателям и сервису Яндекс Музыка.

---

## 📄 Лицензия

Проект распространяется под лицензией [MIT](LICENSE).

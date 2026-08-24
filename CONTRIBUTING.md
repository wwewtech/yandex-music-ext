# Руководство по участию в разработке (Contributing)

Мы рады любому вкладу в развитие **Yandex Music Downloader**! Ниже описаны основные стандарты и шаги для участников.

---

## 🛠️ Локальное окружение и запуск

1. Склонируйте репозиторий:
   ```bash
   git clone https://github.com/wwewtech/yandex-music-ext.git
   cd yandex-music-ext
   ```
2. Откройте страницу расширений Chromium (`chrome://extensions/` или `browser://extensions/`).
3. Включите **Режим разработчика** (Developer mode).
4. Нажмите **Загрузить распакованное расширение** (Load unpacked) и выберите директорию репозитория.

---

## 📐 Архитектурные и дизайн-стандарты

- **Manifest V3 Only**: Расширение строго следует стандартам Chrome MV3 (Service Workers, declarativeNetRequest / downloads API).
- **Zero Framework Bloat**: Чистый Vanilla JavaScript ES6+, zero dependencies для runtime.
- **Fluent Design & Tactile UI**:
  - Никаких блокирующих нативных окон (`alert()`, `prompt()`). Используйте встроенную систему уведомлений `InfoBar` / Toast.
  - Поддержка состояний компонентов (Hover, Active press scale `0.95-0.97`, Disabled, Loading spinner, Success checkmark, Error shake).
  - Никаких эмодзи в кнопках и системных элементах интерфейса — только векторные SVG иконки.
  - Типографика: Segoe UI Variable / Inter, моноширинный стек для битрейта и технических параметров.

---

## 🧪 Валидация перед отправкой PR

Перед созданием Pull Request убедитесь, что:
```bash
# Синтаксическая проверка JS
node --check background.js
node --check content.js
node --check popup.js
node --check id3-writer.js
node --check md5.js
```

---

## 🌿 Процесс работы с Git

1. Создайте тематическую ветку от `main`:
   ```bash
   git checkout -b feature/awesome-feature
   ```
2. Делайте понятные коммиты в формате [Conventional Commits](https://www.conventionalcommits.org/):
   - `feat: ...` — новая функциональность
   - `fix: ...` — исправление ошибки
   - `ui: ...` — улучшения интерфейса и анимаций
   - `docs: ...` — документация
3. Отправьте Pull Request и опишите внесенные изменения.

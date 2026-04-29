chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'download') {
        // Очищаем имя файла от запрещенных символов
        const safeFilename = request.filename.replace(/[\\/:*?"<>|]/g, "_");
        
        chrome.downloads.download({
            url: request.url,
            filename: `${safeFilename}.mp3`,
            saveAs: false // Поставьте true, если хотите чтобы браузер спрашивал куда сохранить
        });
    } else if (request.action === 'fetch_data_url') {
        // Выполняем fetch в background, чтобы обойти CORS ограничения content-скрипта
        fetch(request.url)
            .then(res => {
                if (!res.ok) throw new Error(`HTTP error! limit: ${res.status}`);
                return res.blob();
            })
            .then(blob => {
                const reader = new FileReader();
                reader.onloadend = () => {
                    sendResponse({ dataUrl: reader.result });
                };
                reader.onerror = () => {
                    sendResponse({ error: 'Failed to read blob' });
                };
                reader.readAsDataURL(blob);
            })
            .catch(err => {
                sendResponse({ error: err.message || err.toString() });
            });
        
        // Возвращаем true, т.к. sendResponse будет вызван асинхронно
        return true;
    }
});
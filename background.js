chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'download') {
        // Очищаем имя файла от запрещенных символов
        const safeFilename = request.filename.replace(/[\\/:*?"<>|]/g, "_");
        
        chrome.downloads.download({
            url: request.url,
            filename: `${safeFilename}.mp3`,
            saveAs: false // Поставьте true, если хотите чтобы браузер спрашивал куда сохранить
        });
    }
});
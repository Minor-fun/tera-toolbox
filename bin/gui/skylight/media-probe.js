'use strict';

window.probeMedia = (url, kind) => new Promise((resolve, reject) => {
    const media = kind === 'video' ? document.createElement('video') : new Image();
    const cleanup = () => {
        media.onload = media.onerror = media.onloadeddata = null;
        if (kind === 'video') media.pause();
        media.removeAttribute('src');
        if (kind === 'video') media.load();
    };
    const invalid = () => { cleanup(); reject(new Error('decode')); };
    const ready = () => {
        try {
            const width = media.videoWidth || media.naturalWidth;
            const height = media.videoHeight || media.naturalHeight;
            if (!width || !height || width > 8192 || height > 8192 || width * height > 32000000) return invalid();
            const ratio = Math.min(1, 1920 / width, 1080 / height);
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(width * ratio));
            canvas.height = Math.max(1, Math.round(height * ratio));
            canvas.getContext('2d').drawImage(media, 0, 0, canvas.width, canvas.height);
            const preview = canvas.toDataURL('image/png');
            cleanup();
            resolve(preview);
        } catch (_) { invalid(); }
    };
    media.onerror = invalid;
    if (kind === 'video') {
        media.muted = true;
        media.preload = 'auto';
        media.onloadeddata = ready;
    } else media.onload = ready;
    media.src = url;
    if (kind === 'video') media.load();
});

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const channels = require('./ui-channels.json');
const { mergeConfig, appearanceOf, windowSizeOf } = require('./ui-config');

const assetRoot = path.resolve(__dirname, '../../.ui-assets');
const extensions = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.mp4']);
const assetId = /^[a-f0-9]{32}$/;

function fail(code) {
    const error = new Error(code);
    error.code = code;
    throw error;
}

function validateFile(file) {
    const extension = path.extname(file).toLowerCase();
    if (!extensions.has(extension)) fail('type');
    const stat = fs.statSync(file);
    const limit = (extension === '.mp4' ? 128 : 12) * 1024 * 1024;
    if (!stat.isFile() || stat.size < 12) fail('type');
    if (stat.size > limit) fail('size');
    const header = Buffer.alloc(32);
    const fd = fs.openSync(file, 'r');
    try { fs.readSync(fd, header, 0, header.length, 0); } finally { fs.closeSync(fd); }
    const matches = {
        '.png': header.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')),
        '.jpg': header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff,
        '.jpeg': header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff,
        '.gif': ['GIF87a', 'GIF89a'].includes(header.toString('ascii', 0, 6)),
        '.webp': header.toString('ascii', 0, 4) === 'RIFF' && header.toString('ascii', 8, 12) === 'WEBP',
        '.mp4': header.toString('ascii', 4, 8) === 'ftyp'
    };
    if (!matches[extension]) fail('type');
    return { extension, kind: extension === '.mp4' ? 'video' : extension === '.gif' ? 'gif' : 'image' };
}

class MediaStore {
    constructor(root = assetRoot, probe) {
        this.root = path.resolve(root);
        this.probe = probe;
    }

    directory(id) {
        if (!assetId.test(id || '')) fail('asset');
        if (fs.existsSync(this.root) && fs.lstatSync(this.root).isSymbolicLink()) fail('asset');
        const target = path.resolve(this.root, id);
        if (path.dirname(target) !== this.root) fail('asset');
        return target;
    }

    remove(id) {
        const target = this.directory(id);
        // Only generated, direct child asset directories may be recursively removed.
        try {
            if (fs.lstatSync(target).isSymbolicLink()) return;
            fs.rmSync(target, { recursive: true, force: true });
        } catch (_) { /* Windows may still hold a video open; retry on the next import. */ }
    }

    prune(keep) {
        try {
            if (!fs.existsSync(this.root) || fs.lstatSync(this.root).isSymbolicLink()) return;
            fs.readdirSync(this.root).forEach(id => {
                if (assetId.test(id) && id !== keep) this.remove(id);
            });
        } catch (_) { /* Cleanup must not invalidate a successfully saved background. */ }
    }

    describe(id) {
        if (!id) return null;
        try {
            const directory = this.directory(id);
            if (fs.lstatSync(directory).isSymbolicLink()) return { missing: true };
            const meta = JSON.parse(fs.readFileSync(path.join(directory, 'meta.json'), 'utf8'));
            if (!extensions.has(meta.extension) || !['image', 'gif', 'video'].includes(meta.kind)) return { missing: true };
            const source = path.join(directory, `source${meta.extension}`);
            const preview = path.join(directory, 'preview.png');
            if (![source, preview].every(file => fs.statSync(file).isFile() && !fs.lstatSync(file).isSymbolicLink())) return { missing: true };
            return { id, kind: meta.kind, src: pathToFileURL(source).href, preview: pathToFileURL(preview).href };
        } catch (_) { return { missing: true }; }
    }

    async importFile(source) {
        const type = validateFile(source);
        const id = crypto.randomBytes(16).toString('hex');
        const directory = this.directory(id);
        await fs.promises.mkdir(directory, { recursive: true });
        try {
            const target = path.join(directory, `source${type.extension}`);
            await fs.promises.copyFile(source, target, fs.constants.COPYFILE_EXCL);
            validateFile(target);
            const preview = await this.probe(target, type.kind);
            if (typeof preview !== 'string' || !preview.startsWith('data:image/png;base64,') || preview.length > 12 * 1024 * 1024) fail('decode');
            const bytes = Buffer.from(preview.slice('data:image/png;base64,'.length), 'base64');
            if (!bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) fail('decode');
            await fs.promises.writeFile(path.join(directory, 'preview.png'), bytes);
            await fs.promises.writeFile(path.join(directory, 'meta.json'), JSON.stringify({ version: 1, ...type }));
            return id;
        } catch (error) {
            this.remove(id);
            throw error;
        }
    }
}

async function decodeMedia(BrowserWindow, file, kind) {
    const probe = new BrowserWindow({
        show: false, width: 320, height: 180,
        webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false }
    });
    probe.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    probe.webContents.on('will-navigate', event => event.preventDefault());
    let timer;
    try {
        return await Promise.race([
            (async () => {
                await probe.loadFile(path.join(__dirname, 'skylight/media-probe.html'));
                return probe.webContents.executeJavaScript(`window.probeMedia(${JSON.stringify(pathToFileURL(file).href)}, ${JSON.stringify(kind)})`);
            })(),
            new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error('decode'), { code: 'decode' })), 15000); })
        ]);
    } catch (_) {
        fail('decode');
    } finally {
        clearTimeout(timer);
        if (!probe.isDestroyed()) probe.destroy();
    }
}

function windowState(window) {
    const visible = !!window && !window.isDestroyed() && window.isVisible() && !window.isMinimized();
    return {
        visible,
        active: visible && window.isFocused(),
        maximized: !!window && !window.isDestroyed() && window.isMaximized()
    };
}

function describeBackground(config, store) {
    const appearance = appearanceOf(config);
    if (appearance.background) return store.describe(appearance.background);
    if (appearance.defaultBackground !== 'video') return null;
    const assets = path.join(__dirname, 'skylight/assets/backgrounds');
    return { id: 'builtin-video', builtin: true, kind: 'video',
        src: pathToFileURL(path.join(assets, 'skylight-default.mp4')).href,
        preview: pathToFileURL(path.join(assets, 'skylight-default-poster.jpg')).href };
}

function registerUI({ ipcMain, dialog, BrowserWindow, screen, getWindow, getConfig, saveConfig, store = new MediaStore(assetRoot, (file, kind) => decodeMedia(BrowserWindow, file, kind)) }) {
    let importing = false;
    const owns = event => getWindow() && event.sender === getWindow().webContents;
    ipcMain.handle(channels.windowState, event => windowState(owns(event) ? getWindow() : null));
    ipcMain.on(channels.maximize, event => {
        if (!owns(event)) return;
        const window = getWindow();
        window.isMaximized() ? window.unmaximize() : window.maximize();
    });
    ipcMain.handle(channels.windowSize, (event, request = {}) => {
        if (!owns(event)) return { error: 'window-denied' };
        const window = getWindow();
        const area = screen.getDisplayMatching(window.getBounds()).workArea;
        const limits = windowSizeOf(getConfig(), area);
        if (request && request.action === 'get') return limits;
        if (!request || request.action !== 'set' || !Number.isInteger(request.width) || !Number.isInteger(request.height) ||
            request.width < limits.minWidth || request.width > limits.maxWidth || request.height < limits.minHeight || request.height > limits.maxHeight)
            return { ...limits, error: 'window-size' };
        const next = mergeConfig(getConfig(), { gui: { width: request.width, height: request.height, maximized: false } });
        try {
            // Persist first: a write error must not change the visible window or draft dimensions.
            saveConfig(next);
            if (window.isMaximized()) window.unmaximize();
            window.setMinimumSize(limits.minWidth, limits.minHeight);
            const bounds = window.getBounds();
            window.setBounds({ width: request.width, height: request.height,
                x: Math.max(area.x, Math.min(bounds.x, area.x + area.width - request.width)),
                y: Math.max(area.y, Math.min(bounds.y, area.y + area.height - request.height)) });
            event.sender.send('set config', next);
            return windowSizeOf(next, area);
        } catch (_) { return { error: 'window-failed' }; }
    });
    ipcMain.handle(channels.background, async (event, request = {}) => {
        if (!owns(event)) return { error: 'background-denied' };
        if (request.action === 'get') return { media: describeBackground(getConfig(), store) };
        if (!['import', 'reset', 'preset'].includes(request.action) ||
            (request.action === 'preset' && !['image', 'video'].includes(request.preset))) return { error: 'background-type' };
        if (importing) return { busy: true };
        importing = true;
        let id = null;
        try {
            if (request.action === 'import') {
                const result = await dialog.showOpenDialog(getWindow(), {
                    properties: ['openFile'],
                    filters: [{ name: 'PNG / JPEG / WebP / GIF / MP4', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'mp4'] }]
                });
                if (result.canceled || !result.filePaths.length) return { cancelled: true };
                id = await store.importFile(result.filePaths[0]);
            }
            if (!owns(event) || event.sender.isDestroyed()) {
                if (id) store.remove(id);
                return { cancelled: true };
            }
            const appearance = { background: id };
            if (request.action !== 'import') appearance.defaultBackground = request.action === 'preset' ? request.preset : 'image';
            const next = mergeConfig(getConfig(), { gui: { appearance } });
            saveConfig(next);
            event.sender.send('set config', next);
            store.prune(id);
            return { media: describeBackground(next, store) };
        } catch (error) {
            if (id) store.remove(id);
            return { error: `background-${['size', 'type', 'decode'].includes(error.code) ? error.code : 'failed'}` };
        } finally { importing = false; }
    });

    return function attachWindow(window) {
        // Keep resizable/maximizable enabled for native maximize and title-bar double-click.
        // Electron emits will-resize for manual edge dragging, not setBounds/setSize.
        const preventResize = event => event.preventDefault();
        window.on('will-resize', preventResize);
        const publish = () => {
            if (!window.isDestroyed()) window.webContents.send(channels.windowState, windowState(window));
        };
        const events = ['focus', 'blur', 'show', 'hide', 'minimize', 'restore', 'maximize', 'unmaximize'];
        events.forEach(event => window.on(event, publish));
        window.once('closed', () => {
            events.forEach(event => window.removeListener(event, publish));
            window.removeListener('will-resize', preventResize);
        });
    };
}

function splashAppearance(config) {
    const appearance = appearanceOf(config);
    const media = describeBackground(config, new MediaStore());
    return { theme: config && config.gui && config.gui.theme === 'light' ? 'light' : 'dark',
        reducedMotion: appearance.reducedMotion, backgroundDim: appearance.backgroundDim, backgroundOpacity: appearance.backgroundOpacity,
        preview: media && !media.missing ? media.preview : null };
}

module.exports = { MediaStore, validateFile, decodeMedia, registerUI, windowState, splashAppearance };

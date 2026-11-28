'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const channels = require('./ui-channels.json');
const { mergeConfig, appearanceOf, windowSizeOf, serverProfilesOf, selectedServerOf, backgroundReferences } = require('./ui-config');
const { themeTokensOf } = require('./ui-theme');
const { translator } = require('./ui-i18n');

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
        const retained = keep instanceof Set ? keep : new Set(Array.isArray(keep) ? keep : [keep]);
        try {
            if (!fs.existsSync(this.root) || fs.lstatSync(this.root).isSymbolicLink()) return;
            fs.readdirSync(this.root).forEach(id => {
                if (assetId.test(id) && !retained.has(id)) this.remove(id);
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

function describeGlobalBackground(config, store) {
    const appearance = appearanceOf(config);
    if (appearance.background) return store.describe(appearance.background);
    if (appearance.defaultBackground !== 'video') return null;
    const assets = path.join(__dirname, 'skylight/assets/backgrounds');
    return { id: 'builtin-video', builtin: true, kind: 'video',
        src: pathToFileURL(path.join(assets, 'skylight-default.mp4')).href,
        preview: pathToFileURL(path.join(assets, 'skylight-default-poster.jpg')).href };
}

function describeBackground(config, store, failed = []) {
    const selected = selectedServerOf(config);
    if (selected && selected.backgroundId && !failed.includes(selected.backgroundId)) {
        const media = store.describe(selected.backgroundId);
        if (media && !media.missing && media.kind === 'image') return media;
    }
    const media = describeGlobalBackground(config, store);
    return media && (media.missing || failed.includes(media.id)) ? null : media;
}

function backgroundSnapshot(config, store, failed = []) {
    const selected = selectedServerOf(config);
    const serverMedia = selected && selected.backgroundId ? store.describe(selected.backgroundId) : null;
    const globalMedia = describeGlobalBackground(config, store);
    return {
        media: describeBackground(config, store, failed),
        globalMedia: globalMedia && failed.includes(globalMedia.id) ? { ...globalMedia, missing: true } : globalMedia,
        serverBackgroundMissing: !!(selected && selected.backgroundId &&
            (!serverMedia || serverMedia.missing || serverMedia.kind !== 'image' || failed.includes(selected.backgroundId)))
    };
}

function registerUI({ ipcMain, dialog, BrowserWindow, screen, getWindow, getConfig, saveConfig, store = new MediaStore(assetRoot, (file, kind) => decodeMedia(BrowserWindow, file, kind)) }) {
    let importing = false, pruneRequested = false;
    const prune = () => {
        if (importing) { pruneRequested = true; return; }
        store.prune(backgroundReferences(getConfig()));
    };
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
        if (!request || typeof request !== 'object' || Array.isArray(request)) return { error: 'background-type' };
        const targeted = request.serverId !== undefined;
        const server = targeted && serverProfilesOf(getConfig()).find(profile => profile.id === request.serverId);
        if (targeted && !server) return { error: 'background-target' };
        if (request.action === 'get') {
            if (targeted) return { media: server.backgroundId ? store.describe(server.backgroundId) : null };
            if (request.scope === 'global') return { media: describeGlobalBackground(getConfig(), store) };
            return backgroundSnapshot(getConfig(), store, Array.isArray(request.failed) ? request.failed : []);
        }
        if (!['import', 'reset', 'preset'].includes(request.action) ||
            (targeted && request.action === 'preset') ||
            (request.action === 'preset' && !['image', 'video'].includes(request.preset))) return { error: 'background-type' };
        if (importing) return { busy: true };
        importing = true;
        let id = null, saved = false;
        try {
            if (request.action === 'import') {
                const t = translator(getConfig() && getConfig().uilanguage);
                const result = await dialog.showOpenDialog(getWindow(), {
                    title: t(targeted ? 'serverBackground' : 'background'), buttonLabel: t('selectFile'),
                    properties: ['openFile'],
                    filters: [targeted ? { name: 'PNG / JPEG / WebP', extensions: ['png', 'jpg', 'jpeg', 'webp'] } :
                        { name: 'PNG / JPEG / WebP / GIF / MP4', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'mp4'] }]
                });
                if (result.canceled || !result.filePaths.length) return { cancelled: true };
                if (targeted && validateFile(result.filePaths[0]).kind !== 'image') fail('type');
                id = await store.importFile(result.filePaths[0]);
                if (targeted && store.describe(id).kind !== 'image') fail('type');
            }
            if (!owns(event) || event.sender.isDestroyed()) {
                if (id) store.remove(id);
                return { cancelled: true };
            }
            let patch;
            if (targeted) {
                const profiles = serverProfilesOf(getConfig());
                const target = profiles.find(profile => profile.id === request.serverId);
                if (!target) { if (id) store.remove(id); return { error: 'background-target' }; }
                target.backgroundId = id;
                patch = { gui: { serverProfiles: profiles } };
            } else {
                const appearance = { background: id };
                if (request.action !== 'import') appearance.defaultBackground = request.action === 'preset' ? request.preset : 'image';
                patch = { gui: { appearance } };
            }
            const next = mergeConfig(getConfig(), patch);
            saveConfig(next);
            saved = true;
            event.sender.send('set config', next);
            return backgroundSnapshot(next, store);
        } catch (error) {
            if (id) store.remove(id);
            return { error: `background-${['size', 'type', 'decode'].includes(error.code) ? error.code : 'failed'}` };
        } finally {
            importing = false;
            if (saved || pruneRequested) { pruneRequested = false; prune(); }
        }
    });

    const attachWindow = function(window) {
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
    attachWindow.prune = prune;
    Object.defineProperty(attachWindow, 'mediaBusy', { get: () => importing });
    return attachWindow;
}

function splashAppearance(config, store = new MediaStore()) {
    const appearance = appearanceOf(config);
    const media = describeBackground(config, store);
    const theme = config && config.gui && config.gui.theme;
    const legacyTheme = theme === undefined || theme === null || theme === 'light' ? 'light' : 'dark';
    return { theme: legacyTheme, base: themeTokensOf(appearance.accentColor, legacyTheme).base,
        accentColor: appearance.accentColor,
        reducedMotion: appearance.reducedMotion, backgroundDim: appearance.backgroundDim, backgroundOpacity: appearance.backgroundOpacity,
        preview: media && !media.missing ? media.preview : null };
}

function windowBackgroundColor(config) {
    const appearance = appearanceOf(config);
    return themeTokensOf(appearance.accentColor, config && config.gui && config.gui.theme).base;
}

module.exports = { MediaStore, validateFile, decodeMedia, registerUI, windowState, splashAppearance, windowBackgroundColor, describeBackground, describeGlobalBackground };

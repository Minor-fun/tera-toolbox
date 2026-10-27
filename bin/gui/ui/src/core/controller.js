const { incoming: IN, outgoing: OUT } = require('./events');
const channels = require('../../../ui-channels.json');
const { mergeConfig, appearanceOf } = require('../../../ui-config');
const { LogBuffer, timestamp } = require('./logs');

function displayName(mod) {
    return mod.options && (mod.options.guiName || mod.options.cliName) || mod.rawName || mod.name || '';
}

function canAct(mod, action, state) {
    if (state.modBusy || !state.config) return false;
    if (action === 'install') return !state.running && !state.transition;
    if (mod.isCoreModule) return false;
    if (action === 'uninstall') return !state.running && !state.transition;
    return mod.compatibility === 'compatible';
}

function readProgress(progress) {
    if (!progress || !['preparing', 'updating', 'skipping', 'initializing', 'preloading', 'starting', 'failed', 'ready'].includes(progress.phase) ||
        !Number.isInteger(progress.percent) || progress.percent < 0 || progress.percent > (progress.phase === 'ready' ? 100 : 99)) return null;
    const result = { phase: progress.phase, percent: progress.percent };
    if (progress.total !== undefined) {
        for (const key of ['total', 'completed', 'loaded', 'failed', 'skipped']) {
            if (!Number.isSafeInteger(progress[key]) || progress[key] < 0) return null;
            result[key] = progress[key];
        }
        if (result.completed > result.total || result.loaded + result.failed + result.skipped !== result.completed) return null;
        result.current = typeof progress.current === 'string' ? progress.current.slice(0, 200) : '';
    }
    if (progress.update !== undefined) {
        const update = progress.update;
        if (!update || typeof update !== 'object') return null;
        result.update = {};
        for (const key of ['total', 'completed', 'failed', 'skipped', 'filesCompleted', 'filesTotal']) {
            if (!Number.isSafeInteger(update[key]) || update[key] < 0) return null;
            result.update[key] = update[key];
        }
        if (update.completed > update.total || update.failed + update.skipped > update.completed || update.filesCompleted > update.filesTotal) return null;
        for (const key of ['current', 'file']) result.update[key] = typeof update[key] === 'string' ? update[key].slice(0, 200) : '';
    }
    if (progress.updateError === true) result.updateError = true;
    return result;
}

function createController({ ipc, reactive = value => value, format, schedule = fn => setTimeout(fn, 16), cancel = clearTimeout, startupSound = null }) {
    const state = reactive({
        config: null, running: false, transition: '', admin: false, updateAvailable: false,
        startupProgress: { phase: 'idle', percent: 0 },
        mods: [], available: [], modsLoaded: false, availableLoaded: false, modBusy: false,
        media: null, mediaBusy: false, windowVisible: false, windowActive: false, maximized: false, windowSizeBusy: false,
        error: '', logVersion: 0, logUI: { query: '', paused: false, current: 0, scrollTop: 0 }
    });
    const logs = new LogBuffer(format);
    const listeners = [];
    let connected = false, disposed = false, logTick = null, mediaSequence = 0;

    function stopStartupSound(release = false) {
        if (!startupSound) return;
        try {
            startupSound.pause();
            if (release) { startupSound.removeAttribute('src'); startupSound.load(); }
            else startupSound.currentTime = 0;
        } catch (_) { /* Audio must never block configuration, startup or disposal. */ }
    }

    function playStartupSound() {
        if (!startupSound || !state.config || state.config.gui.startupSound === false) return;
        try {
            startupSound.currentTime = 0;
            Promise.resolve(startupSound.play()).catch(() => {});
        } catch (_) { /* A missing device or rejected playback is not a proxy failure. */ }
    }

    function changedLogs() {
        if (logTick !== null) return;
        logTick = schedule(() => { logTick = null; state.logVersion++; });
    }

    function clearLogs() {
        logs.clear();
        state.logUI.query = '';
        state.logUI.paused = false;
        state.logUI.current = 0;
        changedLogs();
    }

    function listen(channel, listener) {
        const wrapper = (_, ...args) => listener(...args);
        listeners.push([channel, wrapper]);
        ipc.on(channel, wrapper);
    }

    function windowState(value) {
        state.windowVisible = !!(value && value.visible);
        state.windowActive = !!(value && value.active);
        state.maximized = !!(value && value.maximized);
    }

    async function refreshMedia() {
        const sequence = ++mediaSequence;
        try {
            const result = await ipc.invoke(channels.background, { action: 'get' });
            if (!disposed && sequence === mediaSequence) {
                const next = result.media || null;
                const previous = state.media;
                if (!next || !previous || next.id !== previous.id || next.src !== previous.src || next.missing !== previous.missing) state.media = next;
            }
        } catch (_) {
            if (!disposed && sequence === mediaSequence) state.media = null;
        }
    }

    const controller = {
        state, logs, clearLogs,
        connect() {
            if (connected || disposed) return;
            connected = true;
            listen(IN.config, config => {
                const previous = appearanceOf(state.config);
                state.config = mergeConfig({}, config);
                if (state.config.gui.startupSound === false) stopStartupSound();
                const next = appearanceOf(state.config);
                if (previous.background !== next.background || previous.defaultBackground !== next.defaultBackground || state.media === null) refreshMedia();
            });
            listen(IN.admin, value => { state.admin = !!value; });
            listen(IN.update, () => { state.updateAvailable = true; });
            listen(IN.starting, () => {
                stopStartupSound();
                if (state.transition !== 'starting' && state.config && state.config.gui.cleanstart) clearLogs();
                if (state.transition !== 'starting') state.startupProgress = { phase: 'preparing', percent: 0 };
                state.transition = 'starting';
            });
            listen(channels.startupProgress, progress => {
                const next = readProgress(progress);
                if (!next) return;
                if (next.phase === 'ready') {
                    if (!state.running || state.transition || next.percent !== 100) return;
                } else if (state.running || (state.transition !== 'starting' && !(next.phase === 'failed' && !state.transition))) return;
                state.startupProgress = next;
            });
            listen(IN.running, running => {
                const wasStarting = state.transition === 'starting';
                const wasRunning = state.running;
                state.running = !!running;
                state.transition = '';
                // Only the existing backend running acknowledgement can complete startup.
                if (state.running) state.startupProgress = { ...state.startupProgress, phase: 'ready', percent: 100 };
                else if (wasStarting || state.startupProgress.phase === 'failed') state.startupProgress = { ...state.startupProgress, phase: 'failed' };
                else state.startupProgress = { phase: 'idle', percent: 0 };
                // Do not replay on init snapshots, repeated acknowledgements or page changes.
                if (wasStarting && !wasRunning && state.running) playStartupSound();
                else if (!state.running) stopStartupSound();
            });
            listen(IN.log, (message, type) => {
                const entries = Array.isArray(message) ? message : [{ message, type }];
                const includeTimes = state.config && state.config.gui.logtimes;
                entries.forEach(entry => {
                    if (!entry || typeof entry !== 'object') return;
                    logs.append(entry.message, entry.type, includeTimes ? timestamp(new Date()) : '');
                });
                if (entries.length) changedLogs();
            });
            listen(IN.mods, mods => { state.mods = mods; state.modsLoaded = true; state.modBusy = false; });
            listen(IN.available, mods => {
                state.available = mods;
                state.availableLoaded = true;
                state.modBusy = false;
                ipc.send(OUT.mods);
            });
            listen(IN.error, message => { state.error = String(message); state.modBusy = false; });
            let windowStateUpdated = false;
            listen(channels.windowState, value => { windowStateUpdated = true; windowState(value); });
            ipc.send(OUT.init);
            ipc.send(OUT.mods);
            // A newer window event takes precedence over the initial async snapshot.
            ipc.invoke(channels.windowState).then(value => { if (!disposed && !windowStateUpdated) windowState(value); }).catch(() => {});
        },
        dispose() {
            disposed = true;
            listeners.forEach(([channel, listener]) => ipc.removeListener(channel, listener));
            listeners.length = 0;
            if (logTick !== null) cancel(logTick);
            stopStartupSound(true);
        },
        toggleProxy() {
            if (!state.config || state.transition) return false;
            stopStartupSound();
            state.transition = state.running ? 'stopping' : 'starting';
            if (!state.running) state.startupProgress = { phase: 'preparing', percent: 0 };
            if (!state.running && state.config.gui.cleanstart) clearLogs();
            ipc.send(state.running ? OUT.stop : OUT.start);
            return true;
        },
        save(patch) {
            if (!state.config) return;
            state.config = mergeConfig(state.config, patch);
            if (state.config.gui.startupSound === false) stopStartupSound();
            ipc.send(OUT.config, state.config);
        },
        act(mod, action) {
            if (!canAct(mod, action, state) || !['install', 'uninstall', 'toggle', 'autoupdate'].includes(action)) return false;
            state.modBusy = true;
            ipc.send(OUT[action], mod);
            return true;
        },
        send(action, ...args) {
            if (OUT[action]) ipc.send(OUT[action], ...args);
        },
        openLink(url) {
            if (typeof url === 'string' && /^https?:\/\//i.test(url)) ipc.send(OUT.link, url);
        },
        exportLogs() { ipc.send(OUT.logs, logs.export(!!(state.config && state.config.gui.loghtml))); },
        maximize() { ipc.send(channels.maximize); },
        async windowSize(action, width, height) {
            if (state.windowSizeBusy) return null;
            state.windowSizeBusy = true;
            try {
                const result = await ipc.invoke(channels.windowSize, { action, width, height });
                if (result.error) state.error = result.error;
                return result;
            } catch (_) { state.error = 'window-failed'; return null; }
            finally { state.windowSizeBusy = false; }
        },
        async background(action, preset) {
            if (state.mediaBusy) return;
            state.mediaBusy = true;
            try {
                const result = await ipc.invoke(channels.background, action === 'preset' ? { action, preset } : { action });
                if (result.error) state.error = result.error;
                if (!result.cancelled && !result.error && !result.busy) await refreshMedia();
            } catch (_) { state.error = 'background-failed'; }
            finally { state.mediaBusy = false; }
        }
    };
    return controller;
}

module.exports = { createController, displayName, canAct };

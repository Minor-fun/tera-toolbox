const fs = require('fs');
const path = require('path');
const exec = require('child_process').exec;
const { app, BrowserWindow, powerMonitor, Tray, Menu, ipcMain, shell, dialog, screen } = require('electron');
const DataFolder = path.join(__dirname, '..', 'data');
const ModuleFolder = path.join(__dirname, '..', 'mods');
const { resolveUI } = require('./gui/ui-resources');
const { mergeConfig, selectedServerOf } = require('./gui/ui-config');
const uiChannels = require('./gui/ui-channels.json');
const { translator, languageOf } = require('./gui/ui-i18n');

// MUI
const mui = require('tera-toolbox-mui').DefaultInstance;

function InitializeMUI(language) {
    const { InitializeDefaultInstance } = require('tera-toolbox-mui');
    InitializeDefaultInstance(languageOf(language));
}

// Configuration
function LoadConfiguration() {
    delete require.cache[require.resolve('./config')];
    const resultArray = require('./config').loadConfig(true);
    if (resultArray[1] > 0) {
        InitializeMUI(resultArray[0].uilanguage);
        const { dialog } = require('electron');

        dialog.showMessageBoxSync({
            'type': 'warning',
            'buttons': [mui.get('gui/main/modal/buttons/ok')],
            'title': mui.get('loader-gui/error-config-file-corrupt/title'),
            'message': mui.get('loader-cli/warning-config-restore')
        });
    }

    return resultArray[0];
}

function SaveConfiguration(newConfig) {
    global.TeraProxy.DevMode = !!newConfig.devmode;
    global.TeraProxy.GUITheme = newConfig.gui.theme;

    require('./config').saveConfig(newConfig);
    InitializeMUI(newConfig.uilanguage);
    if (gui) gui.refreshTray();
}

// Migration
function Migration() {
    try {
        const { ToolboxMigration } = require('./migration');
        ToolboxMigration();
    } catch (e) {
        const { dialog } = require('electron');

        dialog.showMessageBoxSync({
            'type': 'error',
            'buttons': [mui.get('gui/main/modal/buttons/ok')],
            'title': mui.get('loader-gui/error-migration-failed/title'),
            'message': mui.get('loader-gui/error-migration-failed/message', { 'supportUrl': global.TeraProxy.SupportUrl })
        });

        app.exit();
    }
}

// Installed mod management
const AvailableModuleListUrl = 'https://raw.githubusercontent.com/tera-private-toolbox/tera-mods/master/modulelist.json';
const { listModuleInfos, installModule, uninstallModule, toggleAutoUpdate, toggleLoad } = require('tera-mod-management');

let cachedAvailableModuleList = null;
async function GetInstallableMods(forceRefresh = false) {
    // (Re)download list of all available modules if required
    if (!cachedAvailableModuleList || forceRefresh) {
        const fetch = require('node-fetch');
        try {
            cachedAvailableModuleList = await (await fetch(AvailableModuleListUrl)).json();
        } catch (e) {
            showError(e.toString());
            return [];
        }
    }

    // Filter out already installed mods
    const installedModInfos = listModuleInfos(ModuleFolder);
    return cachedAvailableModuleList.filter(modInfo => !installedModInfos.some(installedModInfo => installedModInfo.name === modInfo.name.toLowerCase()));
}

// Proxy Main
let proxy = null;
let proxyRunning = false;
let proxyStartSequence = 0;
let gameLauncher = null;
let serverUI = null;

async function StartProxy(moduleFolder, proxyConfig, reportProgress) {
    const updateShare = proxyConfig.noupdate ? 0 : 45;
    let updatePercent = 0;
    reportProgress(proxyConfig.noupdate ? 'skipping' : 'updating', 0);
    if (proxyConfig.noupdate) {
        console.warn(mui.get('loader-gui/warning-noupdate-1'));
        console.warn(mui.get('loader-gui/warning-noupdate-2'));
        console.warn(mui.get('loader-gui/warning-noupdate-3'));
        console.warn(mui.get('loader-gui/warning-noupdate-4'));
        console.warn(mui.get('loader-gui/warning-noupdate-5'));
    } else {
        // Auto-update mods and run, we will run the proxy even if the modules are not updated
        const autoUpdate = require('./update');
        try {
            const updateResult = await autoUpdate(moduleFolder, proxyConfig.updatelog, true, progress => {
                const { fraction, ...update } = progress;
                // Dependencies can enlarge the work list; never move backward or finish before all passes settle.
                updatePercent = Math.max(updatePercent, Math.min(updateShare - 1, Math.floor(updateShare * fraction)));
                reportProgress('updating', updatePercent, { update });
            });
            updateResult.legacy.forEach(mod => console.warn(mui.get('loader-gui/warning-update-mod-not-supported', { 'name': mod.name })));
            updateResult.failed.forEach(mod => console.error(mui.get('loader-gui/error-update-mod-failed', { 'name': mod.name })));
        } catch (e) {
            reportProgress('updating', updatePercent, { updateError: true });
            console.error(mui.get('loader-gui/error-update-failed'));
            console.error(e);
        }
    }

    reportProgress('preloading', updateShare);
    const TeraProxy = require('./proxy');
    proxy = new TeraProxy(moduleFolder, DataFolder, proxyConfig, progress => {
        const preloadPercent = progress.total ? updateShare + Math.floor((90 - updateShare) * progress.completed / progress.total) : 90;
        reportProgress('preloading', preloadPercent, progress);
    });

    try {
        reportProgress('initializing', 90);
        // Switch to highest process priority so we don't starve because of game client using all CPU
        const { setHighestProcessPriority } = require('./utils');
        setHighestProcessPriority();

        // Start proxy
        reportProgress('starting', 90);
        // run() starts listening asynchronously; do not report success before the socket is ready.
        await new Promise((resolve, reject) => {
            const server = proxy.clientInterfaceServer.server;
            const cleanup = () => { server.removeListener('listening', ready); server.removeListener('error', failed); };
            const ready = () => { cleanup(); resolve(); };
            const failed = error => { cleanup(); reject(error); };
            server.once('listening', ready);
            server.once('error', failed);
            try { proxy.run(); } catch (error) { failed(error); }
        });
        proxyRunning = true;
        return true;
    } catch (_) {
        console.error(mui.get('loader-gui/error-cannot-start-proxy'));
        try { proxy.destructor(); } catch (error) { console.error(error); }
        proxy = null;
        proxyRunning = false;
        return false;
    }
}

async function StopProxy() {
    proxyStartSequence++;
    if (gameLauncher) gameLauncher.cancel();
    if (!proxy || !proxyRunning)
        return false;

    // Stop proxy
    proxy.destructor();
    proxy = null;
    proxyRunning = false;

    // Switch back to normal process priority
    startupProgress = { phase: 'idle', percent: 0 };
    if (startupProgressTimer !== null) {
        clearTimeout(startupProgressTimer);
        startupProgressTimer = null;
    }
    startupProgressSender = null;
    const { setNormalProcessPriority } = require('./utils');
    setNormalProcessPriority();

    return true;
}

// Periodic update check
let updateCheckInterval = null;
let updateChecker = null;

function StartUpdateCheck(branch, onUpdateAvailable, interval = 30 * 60 * 1000) {
    if (updateCheckInterval || updateChecker)
        return;

    const Updater = require('./update-self');
    updateChecker = new Updater(branch);

    updateCheckInterval = setInterval(async () => {
        try {
            const CheckResult = await updateChecker.check();
            if (CheckResult && CheckResult.operations && CheckResult.operations.length > 0)
                onUpdateAvailable();
        } catch (_) {
            // Ignore
        }
    }, interval);
}

function StopUpdateCheck() {
    clearInterval(updateCheckInterval);
    updateCheckInterval = null;
    updateChecker = null;
}

// Clean exit
const isWindows = process.platform === 'win32';

function cleanExit() {
    console.log(mui.get('loader-gui/terminating'));

    StopProxy().then(() => {
        if (isWindows)
            process.stdin.pause();
    });
}

if (isWindows) {
    require('readline').createInterface({
        'input': process.stdin,
        'output': process.stdout
    }).on('SIGINT', () => process.emit('SIGINT'));
}

process.on('SIGHUP', cleanExit);
process.on('SIGINT', cleanExit);
process.on('SIGTERM', cleanExit);

// IPC
let proxyBusy = false;
let startupProgress = { phase: 'idle', percent: 0 };
let startupProgressTimer = null;
let startupProgressSender = null;
let startupProgressSentPhase = 'idle';

function flushStartupProgress() {
    startupProgressTimer = null;
    const sender = startupProgressSender;
    if (sender && !sender.isDestroyed()) {
        sender.send(uiChannels.startupProgress, startupProgress);
        startupProgressSentPhase = startupProgress.phase;
    }
}

function reportStartupProgress(sender, phase, percent, progress) {
    startupProgress = { ...(phase === 'preparing' ? {} : startupProgress), ...progress, phase, percent };
    startupProgressSender = sender;
    // Loader unit tests execute this file in a minimal VM without timer globals.
    // Keep the original synchronous behavior there while batching in Electron.
    if (typeof setTimeout !== 'function' || typeof clearTimeout !== 'function') {
        flushStartupProgress();
        return;
    }
    // Progress can arrive once per file. Keep phase milestones immediate and
    // coalesce noisy same-phase updates to reduce IPC and renderer work.
    const milestone = ['failed', 'ready'].includes(phase) || phase !== startupProgressSentPhase;
    if (milestone) {
        if (startupProgressTimer !== null) clearTimeout(startupProgressTimer);
        flushStartupProgress();
    } else if (startupProgressTimer === null) {
        startupProgressTimer = setTimeout(flushStartupProgress, 32);
    }
}

async function requestProxyStart(event, options) {
    if (proxyBusy || proxy || proxyRunning || (serverUI && serverUI.busy)) return;
    proxyBusy = true;
    event.sender.send('proxy starting');
    const sequence = ++proxyStartSequence;
    const selected = selectedServerOf(config);
    const profile = options && options.launchGameLauncher === true && gui && gui.window &&
        event.sender === gui.window.webContents && selected && selected.id === options.serverId ? { ...selected } : null;
    const operation = gameLauncher.begin(profile);
    reportStartupProgress(event.sender, 'preparing', 0);
    console.log(mui.get('loader-gui/proxy-starting'));
    try {
        await StartProxy(ModuleFolder, config, (phase, percent, progress) => reportStartupProgress(event.sender, phase, percent, progress));
    } catch (error) {
        showError(error.toString());
    } finally {
        proxyBusy = false;
        reportStartupProgress(event.sender, proxyRunning ? 'ready' : 'failed', proxyRunning ? 100 : startupProgress.percent);
        if (!event.sender.isDestroyed()) event.sender.send('proxy running', proxyRunning);
    }
    if (profile && proxyRunning && sequence === proxyStartSequence) {
        const startedProxy = proxy;
        await gameLauncher.run(operation, () => sequence === proxyStartSequence && proxyRunning && proxy === startedProxy &&
            gui && gui.window && event.sender === gui.window.webContents && !event.sender.isDestroyed());
    } else if (profile && operation === gameLauncher.operation) gameLauncher.cancel();
}

ipcMain.on('init', (event, _) => {
    event.sender.send('set config', config);
    event.sender.send('proxy running', proxyRunning);
    if (proxyBusy && !['ready', 'idle', 'failed'].includes(startupProgress.phase)) event.sender.send('proxy starting');
    startupProgressSender = event.sender;
    startupProgressSentPhase = startupProgress.phase;
    event.sender.send(uiChannels.startupProgress, startupProgress);
    event.sender.send(uiChannels.launcherStatus, gameLauncher.status);
    event.sender.send('is admin', global.TeraProxy.IsAdmin);

    if (config.noselfupdate) {
        console.warn(mui.get('loader-gui/warning-noselfupdate-1'));
        console.warn(mui.get('loader-gui/warning-noselfupdate-2'));
        console.warn(mui.get('loader-gui/warning-noselfupdate-3'));
        console.warn(mui.get('loader-gui/warning-noselfupdate-4'));
        console.warn(mui.get('loader-gui/warning-noselfupdate-5'));
    }

    if (config.gui.autostart) {
        requestProxyStart(event);
    }
});

ipcMain.on('start proxy', requestProxyStart);

ipcMain.on('stop proxy', async (event, _) => {
    if (proxyBusy || !proxy || !proxyRunning)
        return;

    proxyBusy = true;
    console.log(mui.get('loader-gui/proxy-stopping'));
    try {
        await StopProxy();
        console.log(mui.get('loader-gui/proxy-stopped'));
    } catch (error) {
        showError(error.toString());
    } finally {
        proxyBusy = false;
        if (!event.sender.isDestroyed()) event.sender.send('proxy running', proxyRunning);
    }
});

ipcMain.on('get config', (event, _) => {
    event.sender.send('set config', config);
});

ipcMain.on('set config', (event, newConfig) => {
    const next = mergeConfig(config, newConfig);
    try {
        SaveConfiguration(next);
        config = next;
    } catch (error) {
        showError(error.toString());
    }
    event.sender.send('set config', config);
});

ipcMain.on('get mods', (event, _) => {
    event.sender.send('set mods', listModuleInfos(ModuleFolder));
});

ipcMain.on('get installable mods', (event, _) => {
    GetInstallableMods(true).then(mods => event.sender.send('set installable mods', mods));
});

ipcMain.on('install mod', (event, modInfo) => {
    installModule(ModuleFolder, modInfo);
    console.log(mui.get('loader-gui/mod-installed', { 'name': modInfo.name }));
    GetInstallableMods().then(mods => event.sender.send('set installable mods', mods));
});

ipcMain.on('toggle mod load', (event, modInfo) => {
    toggleLoad(modInfo);
    console.log(mui.get('loader-gui/mod-load-toggled', { 'enabled': modInfo.disabled, 'name': modInfo.rawName }));
    event.sender.send('set mods', listModuleInfos(ModuleFolder));
});

ipcMain.on('toggle mod autoupdate', (event, modInfo) => {
    toggleAutoUpdate(modInfo);
    console.log(mui.get('loader-gui/mod-updates-toggled', { 'updatesEnabled': modInfo.disableAutoUpdate, 'name': modInfo.rawName }));
    event.sender.send('set mods', listModuleInfos(ModuleFolder));
});

ipcMain.on('uninstall mod', (event, modInfo) => {
    uninstallModule(modInfo);
    console.log(mui.get('loader-gui/mod-uninstalled', { 'name': modInfo.rawName }));
    event.sender.send('set mods', listModuleInfos(ModuleFolder));
});

ipcMain.on('show mods folder', () => {
    shell.openPath(ModuleFolder);
});

ipcMain.on('open in notepad', (event, str) => {
    exec(`notepad '${str}'`);
});

// TODO: rewrite differently
ipcMain.on('hide window', (event) => {
    if (gui) gui.hide();
});

ipcMain.on('minimize window', (event) => {
    if (gui) gui.minimize();
});

ipcMain.on('close toolbox', (event) => {
    if (gui) gui.close();
});

ipcMain.on('open discord', (event) => {
    shell.openExternal(global.TeraProxy.DiscordUrl);
});

ipcMain.on('save logs', (event, logs) => {
    const t = translator(config && config.uilanguage, require('tera-toolbox-mui').TeraToolboxMUI);
    dialog.showSaveDialog({
        'title': t('export'),
        'buttonLabel': t('saveFile'),
        'filters': [
            {
                'name': t('logFiles'),
                'extensions': ['log']
            }],
        'properties': []
    }).then((file) => {
        if (!file.canceled) {
            fs.writeFile(file.filePath.toString(),
                logs.map(r => r.text).join(''), (err) => {
                    if (err) throw err;
                });
        }
    }).catch(err => {
        console.log(err);
    });
});

ipcMain.on('open link', (event, lnk) => {
    try {
        shell.openExternal(lnk);
    } catch (ex) {}
});

// GUI
class TeraProxyGUI {
    constructor() {
        this.window = null;
        this.tray = null;
        this.skylight = false;
        this.pendingLogs = [];
        this.logTimer = null;
    }

    show() {
        if (this.window !== null) {
            this.window.show();
            if (this.window.isMinimized())
                this.window.restore();
            this.window.focus();
            return;
        }

        // Migration
        Migration();

        // Load configuration
        config = LoadConfiguration();
        InitializeMUI(config.uilanguage);

        global.TeraProxy.GUIMode = true;
        global.TeraProxy.DevMode = !!config.devmode;
        const ui = resolveUI();
        this.skylight = ui.skylight;

        if (!config.gui) {
            config.gui = {
                enabled: true,
                theme: 'light',
                autostart: false,
                logtimes: true,
                width: ui.skylight ? 1280 : 880,
                height: ui.skylight ? 768 : 500,
                maximized: false,
                loghtml: false
            };

            SaveConfiguration(config);
        } else {
            if (config.gui.logtimes === undefined) {
                config.gui.logtimes = true;
                SaveConfiguration(config);
            }

            if (config.gui.loghtml === undefined) {
                config.gui.loghtml = false;
                SaveConfiguration(config);
            }

            // Migrate theme
            if (['classic-white', 'classic-pink', 'white', 'pink'].includes(config.gui.theme)) {
                config.gui.theme = 'light';
                SaveConfiguration(config);
            }
            if (['classic-black', 'black', 'grey'].includes(config.gui.theme)) {
                config.gui.theme = 'dark';
                SaveConfiguration(config);
            }

            global.TeraProxy.GUITheme = config.gui.theme || 'dark';
        }

        // Initialize main window
        const guiRoot = path.join(__dirname, 'gui');
        const guiIcon = path.join(guiRoot, '/assets/icon.ico');

        const size = ui.skylight ? require('./gui/ui-config').windowSizeOf(config, screen.getPrimaryDisplay().workAreaSize) : null;
        this.window = new BrowserWindow({
            title: 'TERA Toolbox',
            width: size ? size.width : (config?.gui?.width || 743),
            height: size ? size.height : (config?.gui?.height || 514),
            minWidth: size ? size.minWidth : 743,
            minHeight: size ? size.minHeight : 514,
            icon: guiIcon,
            frame: false,
            backgroundColor: ui.skylight ? require('./gui/ui-appearance').windowBackgroundColor(config) : (config.gui.theme === 'light' ? '#f5f5f5' : '#121212'),
            resizable: true,
            centered: true,
            show: false,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false,
                enableRemoteModule: !ui.skylight,
                additionalArguments: ui.skylight ? [`--toolbox-language=${encodeURIComponent(languageOf(config.uilanguage))}`] : [],
                devTools: false,
                spellcheck: false,
                // Keep the skylight video background running when the window loses focus.
                backgroundThrottling: !ui.skylight
            }
        });

        // this.window.loadURL('http://localhost:8080/');
        this.window.loadFile(ui.main);
        if (ui.skylight) {
            attachUIWindow(this.window);
            this.window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
            this.window.webContents.on('will-navigate', event => event.preventDefault());
        }
        // this.window.webContents.openDevTools();

        this.window.once('ready-to-show', () => {
            setTimeout(() => {
                this.window.show();
                if (config?.gui?.maximized) this.window.maximize();
            }, 100);
        });

        this.window.on('close', () => {
            config.gui.maximized = this.window.isMaximized();
            if (!config.gui.maximized) {
                const size = this.window.getSize();
                config.gui.width = size[0];
                config.gui.height = size[1];
            }

            SaveConfiguration(config);
        });

        //this.window.on('minimize', () => { this.window.hide(); });
        this.window.on('closed', () => {
            StopProxy();
            this.window = null;
            this.pendingLogs = [];
            if (this.logTimer !== null) {
                clearTimeout(this.logTimer);
                this.logTimer = null;
            }
        });

        // Initialize tray icon
        this.tray = new Tray(guiIcon);
        this.tray.setToolTip('TERA Toolbox');
        this.refreshTray();

        this.tray.on('click', () => {
            if (this.window)
                this.window.isVisible() ? this.window.hide() : this.window.show();
        });

        // Redirect console to built-in one
        const nodeConsole = require('console');
        global.console = new nodeConsole.Console(process.stdout, process.stderr);

        const oldStdout = process.stdout.write;
        process.stdout.write = function(msg, ...args) {
            log(msg, 'log');
            oldStdout(msg, ...args);
        };

        const oldStderr = process.stderr.write;
        process.stderr.write = function(msg, ...args) {
            if (msg.startsWith('warn:'))
                log(msg.replace('warn:', ''), 'warn');
            else
                log(msg, 'error');
            oldStderr(msg, ...args);
        };

        // Start periodic update check
        if (!config.noselfupdate) {
            StartUpdateCheck((config.branch || 'beta').toLowerCase(), () => {
                if (this.window)
                    this.window.webContents.send('update available');
            });
        }

        powerMonitor.on('suspend', () => {
            if (this.window) {
                if (!proxy || !proxyRunning)
                    return;

                console.log(mui.get('loader-gui/proxy-stopping'));

                StopProxy().then(() => {
                    this.window.webContents.send('proxy running', false);
                    console.log(mui.get('loader-gui/proxy-stopped'));
                });
            }
        });
    }

    refreshTray() {
        if (!this.tray || this.trayLanguage === mui.language) return;
        this.tray.setContextMenu(Menu.buildFromTemplate([
            { label: mui.get('loader-gui/tray/quit'), click: () => this.close() }
        ]));
        this.trayLanguage = mui.language;
    }

    hide() {
        if (this.window !== null)
            this.window.hide();
    }

    minimize() {
        if (this.window !== null)
            this.window.minimize();
    }

    close() {
        if (this.window !== null) {
            gameLauncher.cancel();
            StopUpdateCheck();

            this.window.close();
            this.window = null;

            app.exit();
        }
    }

    showError(error) {
        if (this.window)
            this.window.webContents.send('error', error);
    }

    log(msg, type = 'log') {
        if (!this.window) return;
        if (!this.skylight) {
            this.window.webContents.send('log', msg, type);
            return;
        }
        this.pendingLogs.push({ message: msg, type });
        if (this.logTimer === null) this.logTimer = setTimeout(() => this.flushLogs(), 32);
    }

    flushLogs() {
        this.logTimer = null;
        if (!this.window || this.pendingLogs.length === 0) return;
        const entries = this.pendingLogs;
        this.pendingLogs = [];
        this.window.webContents.send('log', entries);
    }
}

// Main
let gui = null;
let config = null;
const attachUIWindow = require('./gui/ui-appearance').registerUI({
    ipcMain, dialog, BrowserWindow, screen,
    getWindow: () => gui && gui.window,
    getConfig: () => config,
    saveConfig: next => { SaveConfiguration(next); config = next; }
});
gameLauncher = new (require('./gui/game-launcher').GameLauncher)({
    onStatus: status => {
        if (gui && gui.window && !gui.window.isDestroyed() && !gui.window.webContents.isDestroyed()) gui.window.webContents.send(uiChannels.launcherStatus, status);
        const key = { opened: 'launcherOpened', 'game-running': 'launcherGameRunning',
            'already-running': 'launcherAlreadyRunning', unconfigured: 'launcherUnconfigured', failed: status.error }[status.status];
        if (key) {
            const t = translator(config && config.uilanguage);
            const message = t(key, { serverName: status.serverName || t('serverDefault') });
            if (status.status === 'failed') console.warn(message); else console.log(message);
        }
    }
});
serverUI = require('./gui/game-servers').registerServers({
    ipcMain, dialog, getWindow: () => gui && gui.window, getConfig: () => config,
    saveConfig: next => { SaveConfiguration(next); config = next; },
    isBusy: () => proxyBusy || gameLauncher.busy || attachUIWindow.mediaBusy,
    onSave: () => { if (attachUIWindow.prune) attachUIWindow.prune(); }
});

function showError(error) {
    console.error(error);
    if (gui)
        gui.showError(error);
}

function log(msg, type = 'log') {
    if (msg.length === 0)
        return;

    if (gui)
        gui.log(msg, type);
}

process.on('warning', (warning) => {
    console.warn(warning.name);
    console.warn(warning.message);
    console.warn(warning.stack);
});

module.exports = function StartGUI() {
    return new Promise((resolve, reject) => {
        const { initGlobalSettings } = require('./utils');
        initGlobalSettings(false).then(() => {
            // Boot GUI
            gui = new TeraProxyGUI;

            if (app.isReady()) {
                gui.show();
                resolve();
            } else {
                app.on('ready', () => {
                    gui.show();
                    resolve();
                });
            }

            app.on('second-instance', () => {
                if (gui)
                    gui.show();
            });

            app.on('window-all-closed', () => {
                if (process.platform !== 'darwin')
                    app.quit();
            });

            app.on('activate', () => {
                gui.show();
            });
        });
    });
};

// Hotfix for https://github.com/nodejs/node/issues/30039
'use strict';
require('module').wrapper[0] += `'use strict';`;

const SupportURL = 'https://discord.gg/CZMYNhXwwS';

const { app } = require('electron');
const path = require('path');
const { resolveUI } = require('./gui/ui-resources');
const { translator, languageOf } = require('./gui/ui-i18n');

// Utility
function showDialog(data) {
    const { dialog } = require('electron');
    dialog.showMessageBoxSync({ buttons: [t('ok')], ...data });
}

// Splash Screen
let SplashScreen = null;
let SplashScreenShowTime = 0;
let SplashCaption = '';
let SplashInfo = '';

function showSplashScreen() {
    try {
        const guiRoot = path.join(__dirname, 'gui');
        const guiIcon = path.join(guiRoot, '/assets/icon.ico');
        const ui = resolveUI();
        const appearance = ui.skylight ? require('./gui/ui-appearance').splashAppearance(config[0]) : null;

        const { BrowserWindow } = require('electron');
        SplashScreen = new BrowserWindow({
            title: 'TERA Toolbox',
            width: 550,
            height: 400,
            minWidth: 550,
            minHeight: 400,
            icon: guiIcon,
            frame: false,
            backgroundColor: appearance ? (appearance.theme === 'light' ? '#F5F6F8' : '#20242A') : '#1e1e1e',
            resizable: false,
            show: false,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false,
                enableRemoteModule: !ui.skylight,
                additionalArguments: [
                    ...(appearance ? [`--toolbox-appearance=${encodeURIComponent(JSON.stringify(appearance))}`] : []),
                    `--toolbox-language=${encodeURIComponent(languageOf(config[0].uilanguage))}`
                ],
                devTools: false
            }
        });

        SplashScreen.loadFile(ui.splash);
        SplashScreen.webContents.once('did-finish-load', () => {
            if (!SplashScreen) return;
            SplashScreen.webContents.send('caption', SplashCaption);
            SplashScreen.webContents.send('info', SplashInfo);
        });
        SplashScreen.once('ready-to-show', () => SplashScreen.show());
        SplashScreenShowTime = Date.now();
    } catch (e) {
        // Ignore any error resulting from splash screen
        SplashScreen = null;
    }
}

function hideSplashScreen(onDone) {
    setTimeout(() => {
        onDone().then(() => {
            if (SplashScreen) {
                SplashScreen.close();
                SplashScreen = null;
            }
        });
    }, SplashScreen ? Math.max(0, 1500 - (Date.now() - SplashScreenShowTime)) : 0);
}

function setSplashScreenCaption(caption) {
    SplashCaption = caption;
    if (SplashScreen)
        SplashScreen.webContents.send('caption', caption);
}

function setSplashScreenInfo(info) {
    SplashInfo = info;
    if (SplashScreen)
        SplashScreen.webContents.send('info', info);
}

// Update
async function updateSelf() {
    delete require.cache[require.resolve('./update-self')];
    const Updater = require('./update-self');

    let errors = [];

    const updater = new Updater(branch);
    updater.on('run_start', () => {
        console.log(`[update] Self-update started (Branch: ${updater.branch})`);

        setSplashScreenCaption(t('selfUpdating'));
        setSplashScreenInfo('');
    });

    updater.on('check_start', (serverIndex) => {
        if (updatelog)
            console.log(`[update] Update check started (Server: ${serverIndex})`);

        setSplashScreenCaption(t('updateChecking'));
        setSplashScreenInfo(t('updateServer', { serverIndex }));
    });
    updater.on('check_success', (serverIndex, operations) => {
        if (updatelog)
            console.log(`[update] Update check finished (Server: ${serverIndex}), ${operations.length} operations required`);

        setSplashScreenCaption(t('updateCheckFinished'));
        setSplashScreenInfo(t('updateServer', { serverIndex }));
    });
    updater.on('check_fail', (serverIndex, e) => {
        errors.push(t('updateServerError', { serverIndex, error: e }));
        console.log(`[update] Update check failed (Server: ${serverIndex}): ${e}`);

        setSplashScreenCaption(t('updateCheckServerFailed', { serverIndex }));
    });
    updater.on('check_fail_all', () => {
        errors.push(t('updateServersError'));
        console.log('[update] Update check failed');

        setSplashScreenCaption(t('updateCheckFailed'));
    });

    updater.on('prepare_start', () => {
        if (updatelog)
            console.log(`[update] Update download and preparation started`);

        setSplashScreenCaption(t('updatePreparing'));
        setSplashScreenInfo('');
    });
    updater.on('download_start', (serverIndex, relpath) => {
        if (updatelog)
            console.log(`[update] - Download: ${relpath} (Server: ${serverIndex})`);

        setSplashScreenCaption(t('updateDownloading', { serverIndex }));
        setSplashScreenInfo(relpath);
    });
    updater.on('download_error', (relpath, expected_hash, downloaded_hash) => {
        console.log(`[update] - Error downloading ${relpath}: file hash mismatch (expected: ${expected_hash}, found: ${downloaded_hash})!`);

        setSplashScreenCaption(t('updateDownloadFailed'));
        setSplashScreenInfo(relpath);

        errors.push(t('updateHashError', { path: relpath, expected: expected_hash, found: downloaded_hash }));
    });
    updater.on('prepare_finish', () => {
        if (updatelog)
            console.log(`[update] Update download and preparation finished`);

        setSplashScreenCaption(t('updatePrepared'));
        setSplashScreenInfo('');
    });

    updater.on('execute_start', () => {
        if (updatelog)
            console.log(`[update] Update installation started`);

        setSplashScreenCaption(t('updateInstalling'));
        setSplashScreenInfo('');
    });
    updater.on('install_start', (relpath) => {
        if (updatelog)
            console.log(`[update] - Install: ${relpath}`);

        setSplashScreenCaption(t('updateInstalling'));
        setSplashScreenInfo(relpath);
    });
    updater.on('install_error', (relpath, e) => {
        console.log(`[update] - Error installing ${relpath}: ${e}`);
        if (relpath.startsWith('node_modules/tera-client-interface/scanner/')) {
            console.log('[update] - Your anti-virus software most likely falsely detected it to be a virus.');
            console.log('[update] - Please whitelist TERA Toolbox in your anti-virus!');
        } else if (relpath === 'node_modules/tera-client-interface/tera-client-interface.dll') {
            console.log('[update] - This is most likely caused by an instance of the game that is still running.');
            console.log('[update] - Close all game clients or restart your computer, then try again!');
        }

        setSplashScreenCaption(t('updateInstallFailed'));
        setSplashScreenInfo(relpath);

        if (relpath.startsWith('node_modules/tera-client-interface/scanner/'))
            errors.push(t('updateInstallError', { path: relpath, error: e }) + '\n\n' + t('updateAntivirusHint'));
        else if (relpath === 'node_modules/tera-client-interface/tera-client-interface.dll')
            errors.push(t('updateInstallError', { path: relpath, error: e }) + '\n\n' + t('updateGameRunningHint'));
        else
            errors.push(t('updateInstallError', { path: relpath, error: e }));
    });
    updater.on('execute_finish', () => {
        if (updatelog)
            console.log(`[update] Update installation finished`);

        setSplashScreenCaption(t('updateInstalled'));
        setSplashScreenInfo('');
    });

    updater.on('run_finish', (success) => {
        console.log(`[update] Self-update ${success ? 'finished' : 'failed'}`);

        setSplashScreenCaption(t(success ? 'selfUpdateFinished' : 'selfUpdateFailed'));
        setSplashScreenInfo('');
    });

    const filesChanged = await updater.run();
    if (errors.length > 0)
        return errors;
    if (filesChanged)
        return await updateSelf();
    return null;
}

// Main function
async function run() {
    const start = require('./loader-gui');
    await start();
}

function main() {
    if (noselfupdate) {
        run();
    } else {
        // Show splash screen
        showSplashScreen();

        // Perform self-update
        updateSelf().then(errors => {
            if (errors && errors.length > 0) {
                let errmsg = t('selfUpdateErrorHelp', { supportUrl: SupportURL }) + '\n\n' + t('fullErrorMessage') + '\n\n------------------------------\n';
                errmsg += errors.join('\n------------------------------\n');

                showDialog({
                    type: 'error',
                    title: t('selfUpdateErrorTitle'),
                    message: errmsg
                });
            }
        }).catch(e => {
            showDialog({
                type: 'error',
                title: t('selfUpdateErrorTitle'),
                message: t('selfUpdateErrorHelp', { supportUrl: SupportURL }) + '\n\n' + t('fullErrorMessage') + `\n${e}`
            });
        }).finally(() => {
            const { updateRequired, update } = require('./update-electron.js');
            if (updateRequired()) {
                setSplashScreenCaption(t('electronUpdating'));
                setSplashScreenInfo('');

                update().catch(e => {
                    showDialog({
                        type: 'error',
                        title: t('electronUpdateErrorTitle'),
                        message: t('electronUpdateErrorHelp', { supportUrl: SupportURL }) + '\n\n' + t('fullErrorMessage') + `\n${e}\n\n` + t('programTerminated')
                    });
                }).finally(() => {
                    app.exit();
                });
            } else {
                hideSplashScreen(run);
            }
        });
    }
}

// -------------------------------------------------------------------
// Safely load configuration
let branch = 'beta';
let updatelog = false;
let noselfupdate = false;

const config = require('./config').loadConfig(true);
const { TeraToolboxMUI, InitializeDefaultInstance } = require('tera-toolbox-mui');
InitializeDefaultInstance(languageOf(config[0].uilanguage));
const t = translator(config[0].uilanguage, TeraToolboxMUI);
SplashCaption = t('splashInitializing');
if (config[1] > 0) console.warn('warn:[update] WARNING: An error occurred while trying to read the config file! Falling back to default values.');
if (config[0].branch) branch = config[0].branch.toLowerCase();
updatelog = !!config[0].updatelog;
noselfupdate = !!config[0].noselfupdate;

// Backwards compatibility until next major update
//app.allowRendererProcessReuse = false;

// Boot
if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
    app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
    app.commandLine.appendSwitch("force_low_power_gpu");

    if (app.isReady())
        main();
    else
        app.on('ready', main);
}

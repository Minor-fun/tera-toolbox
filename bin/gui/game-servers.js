'use strict';

const crypto = require('crypto');
const channels = require('./ui-channels.json');
const { mergeConfig, serverProfilesOf, selectedServerOf } = require('./ui-config');
const { validateExecutable } = require('./game-launcher');
const { translator } = require('./ui-i18n');

function registerServers({ ipcMain, dialog, getWindow, getConfig, saveConfig, isBusy = () => false, onSave = () => {}, validate = validateExecutable }) {
    let busy = false;
    const owns = event => getWindow() && event.sender === getWindow().webContents && !event.sender.isDestroyed();
    ipcMain.handle(channels.serverProfiles, async (event, request = {}) => {
        if (!owns(event)) return { error: 'server-denied' };
        if (!request || !['add', 'rename', 'select', 'remove', 'choose-launcher', 'clear-launcher'].includes(request.action)) return { error: 'server-invalid' };
        if (busy || isBusy()) return { busy: true };
        busy = true;
        try {
            let profiles = serverProfilesOf(getConfig());
            let selected = selectedServerOf(getConfig());
            let selectedId = selected && selected.id || null;
            const index = profiles.findIndex(profile => profile.id === request.serverId);
            if (request.action !== 'add' && index < 0) return { error: 'server-invalid' };
            if (request.action === 'add') {
                const t = translator(getConfig() && getConfig().uilanguage);
                const base = t('newServer');
                let name = base, suffix = 2;
                while (profiles.some(profile => profile.name === name)) name = `${base} ${suffix++}`;
                selectedId = crypto.randomBytes(16).toString('hex');
                profiles.push({ id: selectedId, name, launcherPath: '', backgroundId: null });
            } else if (request.action === 'choose-launcher') {
                const t = translator(getConfig() && getConfig().uilanguage);
                const result = await dialog.showOpenDialog(getWindow(), {
                    title: t('chooseLauncher'), buttonLabel: t('selectFile'), properties: ['openFile'],
                    filters: [{ name: t('executableFiles'), extensions: ['exe'] }]
                });
                if (result.canceled || !result.filePaths.length || !owns(event)) return { cancelled: true };
                const file = validate(result.filePaths[0]);
                profiles = serverProfilesOf(getConfig());
                const target = profiles.find(profile => profile.id === request.serverId);
                if (!target || isBusy()) return { error: 'server-invalid' };
                target.launcherPath = file;
                selected = selectedServerOf(getConfig()); selectedId = selected && selected.id || null;
            } else if (request.action === 'rename') {
                const name = typeof request.name === 'string' ? request.name.trim() : '';
                if (!name || name.length > 80 || /[\r\n\x00-\x1f]/.test(name)) return { error: 'server-name' };
                profiles[index].name = name;
            } else if (request.action === 'select') selectedId = profiles[index].id;
            else if (request.action === 'clear-launcher') profiles[index].launcherPath = '';
            else {
                profiles.splice(index, 1);
                if (selectedId === request.serverId) selectedId = profiles[0] && profiles[0].id || null;
            }
            if (!owns(event)) return { cancelled: true };
            const next = mergeConfig(getConfig(), { gui: { serverProfiles: profiles, selectedServerId: selectedId } });
            saveConfig(next);
            event.sender.send('set config', next);
            try { onSave(); } catch (_) { /* Cleanup must not invalidate a successfully saved profile. */ }
            return { config: next };
        } catch (error) { return { error: error.message === 'launcher-path' ? 'launcher-path' : 'server-failed' }; }
        finally { busy = false; }
    });
    return { get busy() { return busy; } };
}

module.exports = { registerServers };

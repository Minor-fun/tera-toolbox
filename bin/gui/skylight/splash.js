'use strict';

const { ipcRenderer } = require('electron');
const { TeraToolboxMUI } = require('tera-toolbox-mui');
const { translator, languageFromArguments, htmlLanguage } = require('../ui-i18n');
const { themeTokensOf } = require('../ui-theme');
const language = languageFromArguments(process.argv);
const t = translator(language, TeraToolboxMUI);
document.documentElement.lang = htmlLanguage(language);
document.getElementById('caption').textContent = t('splashInitializing');
document.querySelector('[role="progressbar"]').setAttribute('aria-label', t('splashUpdate'));
const argument = process.argv.find(value => value.startsWith('--toolbox-appearance='));
try {
    const appearance = argument ? JSON.parse(decodeURIComponent(argument.slice('--toolbox-appearance='.length))) : {};
    const theme = themeTokensOf(appearance.accentColor, appearance.theme);
    document.body.classList.toggle('reduced', appearance.reducedMotion === true);
    document.body.style.setProperty('--accent', theme.accent);
    document.body.style.setProperty('--surface', theme.surfaceRgb);
    document.body.style.setProperty('--text', theme.text);
    document.body.style.setProperty('--border', theme.border);
    document.body.style.color = theme.text;
    document.body.style.backgroundColor = theme.base;
    if (Number.isFinite(appearance.backgroundDim)) document.body.style.setProperty('--dim', Math.max(0, Math.min(1, appearance.backgroundDim)));
    if (Number.isFinite(appearance.backgroundOpacity)) document.body.style.setProperty('--background-opacity', Math.max(0, Math.min(1, appearance.backgroundOpacity)));
    if (typeof appearance.preview === 'string' && appearance.preview.startsWith('file:')) document.getElementById('background').src = appearance.preview;
} catch (_) { /* An invalid appearance must not block startup. */ }
document.getElementById('background').onerror = event => {
    event.target.onerror = null;
    event.target.src = './assets/backgrounds/skylight-default.png';
};
const caption = (_, value) => { document.getElementById('caption').textContent = String(value); };
const info = (_, value) => { document.getElementById('info').textContent = String(value); };
ipcRenderer.on('caption', caption);
ipcRenderer.on('info', info);
window.addEventListener('unload', () => {
    ipcRenderer.removeListener('caption', caption);
    ipcRenderer.removeListener('info', info);
}, { once: true });

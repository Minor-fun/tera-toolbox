'use strict';

if (typeof require === 'function') {
    const { ipcRenderer } = require('electron');
    const { TeraToolboxMUI, LanguageNames } = require('tera-toolbox-mui');
    window.renderer = ipcRenderer;
    window.TeraToolboxMUI = TeraToolboxMUI;
    window.languageNames = LanguageNames;
}

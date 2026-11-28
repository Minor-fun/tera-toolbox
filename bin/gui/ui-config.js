'use strict';

const { normalizeAccentColor } = require('./ui-theme');

const blockedKeys = new Set(['__proto__', 'constructor', 'prototype']);
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

// Merge UI edits without dropping branch, plugin settings, BigInts, or future fields.
function mergeConfig(current, patch) {
    const result = {};
    for (const source of [current, patch]) {
        if (!isRecord(source)) continue;
        for (const [key, value] of Object.entries(source)) {
            if (blockedKeys.has(key)) continue;
            result[key] = isRecord(value) ? mergeConfig(result[key], value) :
                Array.isArray(value) ? value.map(item => isRecord(item) ? mergeConfig({}, item) : item) : value;
        }
    }
    return result;
}

function appearanceOf(config) {
    const value = config && config.gui && config.gui.appearance || {};
    const clamp = (number, fallback, min, max) => Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
    return {
        background: typeof value.background === 'string' && /^[a-f0-9]{32}$/.test(value.background) ? value.background : null,
        defaultBackground: value.defaultBackground === 'video' ? 'video' : 'image',
        sidebarExpanded: value.sidebarExpanded === true,
        reducedMotion: value.reducedMotion === true,
        backgroundDim: clamp(value.backgroundDim, 0, 0, 1),
        backgroundOpacity: clamp(value.backgroundOpacity, 1, 0, 1),
        pageAcrylic: typeof value.pageAcrylic === 'boolean' ? value.pageAcrylic : true,
        pageSemiTransparent: typeof value.pageSemiTransparent === 'boolean' ? value.pageSemiTransparent : true,
        pageOpacity: clamp(value.pageOpacity, 0.7, 0.1, 1),
        frameOpacity: clamp(value.frameOpacity, 0, 0, 1),
        panelOpacity: clamp(value.panelOpacity, 0.5, 0, 1),
        accentColor: normalizeAccentColor(value.accentColor)
    };
}

function serverProfilesOf(config) {
    const profiles = config && config.gui && config.gui.serverProfiles;
    const seen = new Set();
    return (Array.isArray(profiles) ? profiles : []).filter(profile => {
        if (!isRecord(profile) || !/^[a-f0-9]{32}$/.test(profile.id || '') || seen.has(profile.id)) return false;
        seen.add(profile.id);
        return true;
    }).map(profile => ({
        ...profile,
        name: typeof profile.name === 'string' ? profile.name.trim().slice(0, 80) : '',
        launcherPath: typeof profile.launcherPath === 'string' ? profile.launcherPath : '',
        backgroundId: /^[a-f0-9]{32}$/.test(profile.backgroundId || '') ? profile.backgroundId : null
    }));
}

function selectedServerOf(config) {
    const profiles = serverProfilesOf(config);
    return profiles.find(profile => profile.id === (config && config.gui && config.gui.selectedServerId)) || profiles[0] || null;
}

function backgroundReferences(config) {
    return new Set([appearanceOf(config).background, ...serverProfilesOf(config).map(profile => profile.backgroundId)].filter(Boolean));
}

const defaultWindowSize = { width: 1280, height: 768 };

function windowSizeOf(config, workArea) {
    const gui = config && config.gui || {};
    const maxWidth = Math.floor(workArea.width), maxHeight = Math.floor(workArea.height);
    const minWidth = Math.min(743, maxWidth), minHeight = Math.min(514, maxHeight);
    const fit = (value, fallback, min, max) => Math.max(min, Math.min(max, Number.isInteger(value) && value > 0 ? value : fallback));
    return {
        width: fit(gui.width, defaultWindowSize.width, minWidth, maxWidth),
        height: fit(gui.height, defaultWindowSize.height, minHeight, maxHeight),
        minWidth, minHeight, maxWidth, maxHeight
    };
}

module.exports = { mergeConfig, appearanceOf, windowSizeOf, defaultWindowSize, serverProfilesOf, selectedServerOf, backgroundReferences };

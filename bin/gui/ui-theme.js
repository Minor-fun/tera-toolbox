'use strict';

const RAW_THEME_PRESETS = [
    { id: 'light', theme: 'light', accentColor: null, swatch: '#f5f6f8' },
    { id: 'dark', theme: 'dark', accentColor: null, swatch: '#20242a' },
    { id: 'sakura', accentColor: '#f4b4c9', swatch: '#f4b4c9' },
    { id: 'cream', accentColor: '#f3d5a5', swatch: '#f3d5a5' },
    { id: 'rose', accentColor: '#c93b6b', swatch: '#c93b6b' },
    { id: 'violet', accentColor: '#6d4aff', swatch: '#6d4aff' },
    { id: 'emerald', accentColor: '#1b7a58', swatch: '#1b7a58' }
];

function normalizeAccentColor(value) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim().toLowerCase();
    return /^#[0-9a-f]{6}$/.test(trimmed) ? trimmed : null;
}

function parseHex(hex) {
    return [
        parseInt(hex.slice(1, 3), 16),
        parseInt(hex.slice(3, 5), 16),
        parseInt(hex.slice(5, 7), 16)
    ];
}

function toHex(r, g, b) {
    const channel = n => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
    return `#${channel(r)}${channel(g)}${channel(b)}`;
}

function rgba(rgb, alpha) {
    return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

function relativeLuminance(r, g, b) {
    const linear = c => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function rgbToHsl(r, g, b) {
    const rn = r / 255, gn = g / 255, bn = b / 255;
    const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
    const l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h = 0;
    if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    return [h / 6, s, l];
}

function hslToRgb(h, s, l) {
    if (s === 0) {
        const v = Math.round(l * 255);
        return [v, v, v];
    }
    const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    return [
        Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
        Math.round(hue2rgb(p, q, h) * 255),
        Math.round(hue2rgb(p, q, h - 1 / 3) * 255)
    ];
}

function contrastRatio(lumA, lumB) {
    const hi = Math.max(lumA, lumB), lo = Math.min(lumA, lumB);
    return (hi + 0.05) / (lo + 0.05);
}

// Decide only whether black ink beats white ink in WCAG contrast against a color.
function useDarkInk(rgb) {
    const lum = relativeLuminance(...rgb);
    return contrastRatio(lum, 0) > contrastRatio(lum, 1);
}

function contrastInkOf(hex, darkInk = '#132c38', lightInk = '#ffffff') {
    const normalized = normalizeAccentColor(hex);
    if (!normalized) return lightInk;
    return useDarkInk(parseHex(normalized)) ? darkInk : lightInk;
}

function clampUnit(value) {
    return Math.max(0, Math.min(1, value));
}

function shiftColor(h, s, l, deltaL, satScale = 1) {
    return hslToRgb(h, clampUnit(s * satScale), clampUnit(l + deltaL));
}

function mixRgb(rgbA, rgbB, weightB) {
    const weightA = 1 - weightB;
    return rgbA.map((channel, index) => Math.round(channel * weightA + rgbB[index] * weightB));
}

function ensureReadableContrast(rgb, surfaceLum, preferLightInk, minRatio = 4.5) {
    if (contrastRatio(relativeLuminance(...rgb), surfaceLum) >= minRatio) return rgb;
    const [h, s, initialL] = rgbToHsl(...rgb);
    let low = preferLightInk ? initialL : 0;
    let high = preferLightInk ? 1 : initialL;
    let best = null;
    for (let i = 0; i < 18; i++) {
        const mid = (low + high) / 2;
        const candidate = hslToRgb(h, s, mid);
        const ok = contrastRatio(relativeLuminance(...candidate), surfaceLum) >= minRatio;
        if (preferLightInk) {
            if (ok) { best = candidate; high = mid; } else low = mid;
        } else {
            if (ok) { best = candidate; low = mid; } else high = mid;
        }
    }
    return best || hslToRgb(h, s, preferLightInk ? 0.98 : 0.04);
}

// Push primary button fills away from the chosen base color so actions stand out clearly.
function deriveLayeredAccent(h, s, l, surfaceLum, darkInk) {
    const fillSat = s < 0.08 ? s : clampUnit(Math.max(s, 0.56));
    const inkLum = darkInk ? 1 : 0.023;
    const fits = rgb => {
        const lum = relativeLuminance(...rgb);
        return contrastRatio(lum, surfaceLum) >= 2.6 && contrastRatio(lum, inkLum) >= 4.5;
    };
    let low = darkInk ? 0.06 : l;
    let high = darkInk ? l : 0.94;
    const seed = hslToRgb(h, fillSat, darkInk ? Math.max(0.20, Math.min(0.42, l - 0.34)) : Math.min(0.88, Math.max(0.64, l + 0.24)));
    if (fits(seed)) return seed;
    let found = null;
    for (let i = 0; i < 18; i++) {
        const mid = (low + high) / 2;
        const candidate = hslToRgb(h, fillSat, mid);
        if (fits(candidate)) {
            found = candidate;
            if (darkInk) low = mid;
            else high = mid;
        } else {
            if (darkInk) high = mid;
            else low = mid;
        }
    }
    return found || hslToRgb(h, fillSat, darkInk ? 0.14 : 0.90);
}

// Plugin functional status colors & text-contrast helpers stay isolated from user theme hue.
function functionalContrastTokens(darkInk, serverMgmtBg) {
    return darkInk
        ? {
            green: '#28704b', warning: '#885c18', danger: '#ad4141',
            author: '#1e6950', authorBg: 'rgba(40, 112, 75, .12)',
            version: '#1c5f87', versionBg: 'rgba(42, 111, 151, .12)',
            date: '#8a5a14', dateBg: 'rgba(136, 92, 24, .12)',
            controlOn: 'rgba(218, 240, 228, .94)', controlOnHover: 'rgba(198, 232, 214, .98)',
            updateAction: '#1d63b8', controlUpdate: 'rgba(216, 232, 250, .94)', controlUpdateHover: 'rgba(196, 220, 248, .98)',
            controlDanger: 'rgba(248, 224, 224, .94)', controlDangerHover: 'rgba(244, 206, 206, .98)',
            coreTag: '#2a6f97', coreTagBg: 'rgba(42, 111, 151, .14)',
            installAction: '#2a6f97', installFill: '#2a6f97', installInk: '#fff', controlInstall: 'rgba(218, 236, 247, .94)',
            markBg: '#f9e497', markInk: '#332b12', markActiveBg: '#f2bd80', markActiveInk: '#302415', markActiveOutline: '#a56628',
            railIconShadow: 'drop-shadow(0 1px 2px rgba(255, 255, 255, .85))',
            serverMgmtBg
        }
        : {
            green: '#92d8b0', warning: '#eacb89', danger: '#f3a6a5',
            author: '#9fe6ca', authorBg: 'rgba(146, 216, 176, .16)',
            version: '#a3dbff', versionBg: 'rgba(138, 206, 235, .16)',
            date: '#f0cf8c', dateBg: 'rgba(234, 203, 137, .16)',
            controlOn: 'rgba(42, 86, 68, .86)', controlOnHover: 'rgba(50, 102, 80, .94)',
            updateAction: '#70baff', controlUpdate: 'rgba(44, 76, 114, .86)', controlUpdateHover: 'rgba(54, 92, 136, .94)',
            controlDanger: 'rgba(96, 48, 52, .86)', controlDangerHover: 'rgba(118, 56, 60, .94)',
            coreTag: '#8aceeb', coreTagBg: 'rgba(138, 206, 235, .14)',
            installAction: '#8aceeb', installFill: '#93d3ec', installInk: '#132c38', controlInstall: 'rgba(46, 82, 104, .88)',
            markBg: '#79671f', markInk: '#fff9d4', markActiveBg: '#a66321', markActiveInk: '#fff', markActiveOutline: '#e2ad64',
            railIconShadow: 'drop-shadow(0 1px 2px rgba(0, 0, 0, .5))',
            serverMgmtBg
        };
}

// Derive an entire cohesive palette centered directly on the user's chosen color.
function themeTokensOf(accentColor, legacyTheme = 'light') {
    const normalized = normalizeAccentColor(accentColor);

    if (!normalized) {
        const darkInk = legacyTheme === 'light' || legacyTheme === null;
        return {
            ...(darkInk
                ? {
                    darkInk: true, colorScheme: 'light',
                    accent: '#2a6f97', accentFill: '#2a6f97', accentInk: '#fff',
                    selected: 'rgba(42, 111, 151, .14)', controlSelected: 'rgba(214, 233, 245, .94)',
                    base: '#f5f6f8', surfaceRgb: '245, 246, 248', railRgb: '238, 242, 246', sceneWash: '245, 246, 248',
                    text: '#1e252d', muted: '#586975', border: 'rgba(39, 64, 82, .15)', hover: 'rgba(45, 76, 94, .08)',
                    controlBg: 'rgba(255, 255, 255, .82)', controlHover: 'rgba(255, 255, 255, .96)',
                    controlTrack: 'rgba(226, 234, 241, .84)', controlInput: 'rgba(255, 255, 255, .78)',
                    progressTrack: 'rgba(39, 64, 82, .12)',
                    chromeFill: 'rgba(255, 255, 255, .78)', chromeInk: '#263641', chromeBorder: 'rgba(255, 255, 255, .66)',
                    chromeHover: 'rgba(255, 255, 255, .92)', chromeActive: 'rgba(38, 54, 65, .14)',
                    navActiveBg: 'rgba(255, 255, 255, .94)', navActiveInk: '#1e252d'
                }
                : {
                    darkInk: false, colorScheme: 'dark',
                    accent: '#8aceeb', accentFill: '#93d3ec', accentInk: '#132c38',
                    selected: 'rgba(138, 206, 235, .14)', controlSelected: 'rgba(54, 88, 110, .92)',
                    base: '#20242a', surfaceRgb: '32, 36, 42', railRgb: '26, 32, 40', sceneWash: '32, 36, 42',
                    text: '#f3f6fa', muted: '#b3c2cd', border: 'rgba(220, 238, 247, .14)', hover: 'rgba(220, 239, 249, .08)',
                    controlBg: 'rgba(52, 62, 74, .82)', controlHover: 'rgba(66, 80, 96, .92)',
                    controlTrack: 'rgba(24, 30, 38, .76)', controlInput: 'rgba(24, 30, 38, .76)',
                    progressTrack: 'rgba(220, 238, 247, .14)',
                    chromeFill: 'rgba(32, 38, 46, .84)', chromeInk: '#f3f6fa', chromeBorder: 'rgba(220, 238, 247, .18)',
                    chromeHover: 'rgba(220, 239, 249, .14)', chromeActive: 'rgba(220, 239, 249, .22)',
                    navActiveBg: 'rgba(255, 255, 255, .16)', navActiveInk: '#fff'
                }),
            ...functionalContrastTokens(darkInk, darkInk ? 'rgba(45, 76, 94, .08)' : 'rgba(0, 0, 0, .06)')
        };
    }

    const surface = parseHex(normalized);
    const [h, s, l] = rgbToHsl(...surface);
    const surfaceString = surface.join(', ');
    const surfaceLum = relativeLuminance(...surface);
    const darkInk = useDarkInk(surface);
    const preferLightInk = !darkInk;

    const rail = shiftColor(h, s, l, l < 0.16 ? 0.05 : -0.055, 1.04);
    const ctrlBg = darkInk
        ? shiftColor(h, s, l, l > 0.90 ? -0.045 : 0.06, 0.85)
        : shiftColor(h, s, l, 0.075, 0.94);
    const ctrlHover = darkInk
        ? shiftColor(h, s, l, l > 0.88 ? -0.085 : 0.10, 0.78)
        : shiftColor(h, s, l, 0.13, 0.92);
    const ctrlTrack = darkInk
        ? shiftColor(h, s, l, -0.09, 1.06)
        : shiftColor(h, s, l, l < 0.14 ? 0.045 : -0.065, 1.04);
    const ctrlInput = darkInk ? ctrlBg : ctrlTrack;
    const chromeSurface = darkInk
        ? shiftColor(h, s, l, l > 0.88 ? -0.04 : 0.065, 0.86)
        : shiftColor(h, s, l, l < 0.18 ? 0.07 : -0.08, 0.96);

    const textRgb = ensureReadableContrast(
        hslToRgb(h, Math.min(s, 0.28) * 0.35, darkInk ? 0.12 : 0.96),
        surfaceLum, preferLightInk, 7.0
    );
    const mutedRgb = ensureReadableContrast(
        hslToRgb(h, Math.min(s, 0.38) * 0.40, darkInk ? 0.30 : 0.80),
        surfaceLum, preferLightInk, 4.5
    );
    const chromeLum = relativeLuminance(...chromeSurface);
    const chromeDarkInk = useDarkInk(chromeSurface);
    const chromeInkRgb = ensureReadableContrast(
        hslToRgb(h, Math.min(s, 0.28) * 0.35, chromeDarkInk ? 0.12 : 0.96),
        chromeLum, !chromeDarkInk, 7.0
    );

    const fillRgb = deriveLayeredAccent(h, s, l, surfaceLum, darkInk);
    const accentFill = toHex(...fillRgb);
    const accentInk = darkInk ? '#ffffff' : '#132c38';
    const accentRgb = ensureReadableContrast(fillRgb, surfaceLum, preferLightInk, 4.5);
    const accent = toHex(...accentRgb);

    const controlSelectedRgb = mixRgb(surface, fillRgb, 0.34);
    const navActiveRgb = mixRgb(surface, fillRgb, 0.42);
    const navActiveLum = relativeLuminance(...navActiveRgb);
    const navActiveDarkInk = useDarkInk(navActiveRgb);
    const navActiveInkRgb = ensureReadableContrast(
        hslToRgb(h, Math.min(s, 0.24) * 0.35, navActiveDarkInk ? 0.10 : 0.97),
        navActiveLum, !navActiveDarkInk, 4.5
    );

    return {
        darkInk,
        colorScheme: darkInk ? 'light' : 'dark',
        accent,
        accentFill,
        accentInk,
        selected: rgba(accentRgb, darkInk ? '.16' : '.22'),
        controlSelected: rgba(controlSelectedRgb, '.94'),
        base: normalized,
        surfaceRgb: surfaceString,
        railRgb: rail.join(', '),
        sceneWash: surfaceString,
        text: toHex(...textRgb),
        muted: toHex(...mutedRgb),
        border: rgba(textRgb, '.18'),
        hover: rgba(textRgb, '.10'),
        controlBg: rgba(ctrlBg, '.84'),
        controlHover: rgba(ctrlHover, darkInk ? '.96' : '.94'),
        controlTrack: rgba(ctrlTrack, darkInk ? '.86' : '.82'),
        controlInput: rgba(ctrlInput, darkInk ? '.84' : '.82'),
        progressTrack: rgba(textRgb, darkInk ? '.14' : '.18'),
        chromeFill: rgba(chromeSurface, '.86'),
        chromeInk: toHex(...chromeInkRgb),
        chromeBorder: rgba(textRgb, '.22'),
        chromeHover: rgba(chromeInkRgb, '.12'),
        chromeActive: rgba(accentRgb, '.24'),
        navActiveBg: rgba(navActiveRgb, '.92'),
        navActiveInk: toHex(...navActiveInkRgb),
        ...functionalContrastTokens(darkInk, rgba(textRgb, '.08'))
    };
}

function accentTokensOf(accentColor, isDark = true) {
    return themeTokensOf(accentColor, isDark ? 'dark' : 'light');
}

const THEME_PRESETS = Object.freeze(RAW_THEME_PRESETS.map(preset => Object.freeze({
    ...preset,
    accentSwatch: themeTokensOf(preset.accentColor, preset.theme).accentFill
})));

module.exports = { THEME_PRESETS, ACCENT_PRESETS: THEME_PRESETS, normalizeAccentColor, contrastInkOf, themeTokensOf, accentTokensOf };

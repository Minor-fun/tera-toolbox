'use strict';

const locales = {
    en: require('./locales/en.json'), zh: loadLocale(() => require('./locales/zh.json')),
    de: loadLocale(() => require('./locales/de.json')), es: loadLocale(() => require('./locales/es.json')),
    it: loadLocale(() => require('./locales/it.json')), pl: loadLocale(() => require('./locales/pl.json')),
    'pt-BR': loadLocale(() => require('./locales/pt-BR.json')), ru: loadLocale(() => require('./locales/ru.json')),
    tr: loadLocale(() => require('./locales/tr.json')), ar: loadLocale(() => require('./locales/ar.json')), ba: loadLocale(() => require('./locales/ba.json'))
};
const languages = Object.freeze(Object.keys(locales));
const sharedKeys = new Set(['appName', 'editionName']);

// Reuse only unchanged meanings; rewritten hints and warnings belong in the locale files.
const legacyRoutes = Object.freeze({
    start: 'gui/main/start-stop-proxy-not-running', stop: 'gui/main/start-stop-proxy-running',
    starting: 'gui/main/start-stop-proxy-starting', stopping: 'gui/main/start-stop-proxy-stopping',
    running: 'gui/main/status-proxy-running', stopped: 'gui/main/status-proxy-not-running',
    browse: 'gui/main/static/tabs/newmods/title', logs: 'gui/main/static/tabs/log/title',
    settings: 'gui/main/static/tabs/settings/title', game: 'gui/main/static/tabs/settings/groupclient',
    folder: 'gui/main/static/tabs/modsfolder/title', credits: 'gui/main/static/tabs/credits/title',
    ok: 'gui/main/modal/buttons/ok', readme: 'gui/tooltip/readme',
    support: 'gui/tooltip/supportLink', donate: 'gui/tooltip/donate',
    ...Object.fromEntries([
        'autostart', 'updatelog', 'logtimes', 'loghtml', 'noupdate', 'noselfupdate',
        'noslstags', 'noserverautojoin', 'minimizetotray', 'removecounters', 'devmode', 'theme'
    ].map(key => [key, `gui/main/static/tabs/settings/content/${key}`])),
    language: 'gui/main/static/tabs/settings/content/uilanguage'
});
const aliases = { 'zh-cn': 'zh', 'zh-hans': 'zh', bs: 'ba', 'bs-ba': 'ba' };

function loadLocale(load) {
    try {
        const dictionary = load();
        if (dictionary && typeof dictionary === 'object' && !Array.isArray(dictionary)) return dictionary;
    } catch (_) { /* A missing non-English locale falls back to the shipped English dictionary. */ }
    return {};
}

function languageOf(value) {
    const code = typeof value === 'string' ? value.trim().replace(/_/g, '-').toLowerCase() : '';
    return languages.find(language => language.toLowerCase() === code) ||
        (Object.prototype.hasOwnProperty.call(aliases, code) ? aliases[code] : 'en');
}

function htmlLanguage(language) {
    const code = languageOf(language);
    return code === 'ba' ? 'bs' : code;
}

function languageFromArguments(args = [], fallback = 'en') {
    const prefix = '--toolbox-language=';
    const argument = args.find(value => typeof value === 'string' && value.startsWith(prefix));
    try { return languageOf(argument ? decodeURIComponent(argument.slice(prefix.length)) : fallback); }
    catch (_) { return 'en'; }
}

function label(dictionary, key) {
    const value = Object.prototype.hasOwnProperty.call(dictionary, key) && dictionary[key];
    return typeof value === 'string' && value.trim() ? value : undefined;
}

function translator(language = 'en', MUI) {
    language = languageOf(language);
    let mui;
    // Inject MUI: importing its fs/path loader here would pull Node dependencies into the UI bundle.
    try { if (typeof MUI === 'function') mui = new MUI(language); } catch (_) { /* Keep the emergency English fallback. */ }
    return (key, values = {}) => {
        let value = label(locales[language], key);
        if (value === undefined && sharedKeys.has(key)) value = label(locales.en, key);
        if (value === undefined && mui && Object.prototype.hasOwnProperty.call(legacyRoutes, key)) {
            try {
                const old = mui.get(legacyRoutes[key]);
                if (typeof old === 'string' && old.trim() && old !== legacyRoutes[key]) value = old;
            } catch (_) { /* Missing or damaged legacy resources must not block startup. */ }
        }
        if (value === undefined) value = label(locales.en, key) || key;
        return String(value).replace(/\{(\w+)\}/g, (_, name) => values[name] === undefined ? `{${name}}` : values[name]);
    };
}

module.exports = { translator, languageOf, htmlLanguage, languageFromArguments, languages, legacyRoutes };

<template>
  <v-app :class="{ 'reduce-motion': reduced }" :style="appearanceStyle">
    <div class="toolbox-window" :class="{ 'nav-expanded': appearance.sidebarExpanded, 'on-tool-page': page !== 'home', 'video-background': videoBackground, 'acrylic-enabled': acrylicEnabled }">
      <BackgroundLayer :media="state.media" :window-visible="state.windowVisible" @failed="backgroundFailed" />
      <div class="page-background-overlay" :class="{ 'page-acrylic': acrylicEnabled }" aria-hidden="true"></div>
      <aside ref="navigation" class="navigation-rail">
        <span v-show="indicatorTop !== null" class="navigation-indicator" :style="{ transform: 'translateY(' + indicatorTop + 'px)' }" aria-hidden="true"></span>
        <div class="brand-mark"><img :src="'../assets/icon.ico'" alt="TERA Toolbox"><span class="nav-label" aria-hidden="true">Toolbox</span></div>
        <button class="nav-toggle" :aria-label="t(appearance.sidebarExpanded ? 'collapse' : 'expand')" :title="t(appearance.sidebarExpanded ? 'collapse' : 'expand')" @click="toggleNavigation"><Icon :name="appearance.sidebarExpanded ? 'left' : 'menu'" /></button>
        <nav class="main-navigation" aria-label="Toolbox"><button v-for="item in ['home', 'plugins', 'logs']" :key="item" :class="{ selected: page === item }" :title="t(item)" :aria-label="t(item)" :aria-current="page === item ? 'page' : null" @click="navigate(item)"><Icon :name="item" /><span class="nav-label" aria-hidden="true">{{ t(item) }}</span></button></nav>
        <button class="settings-navigation" :class="{ selected: page === 'settings' }" :title="t('settings')" :aria-label="t('settings')" :aria-current="page === 'settings' ? 'page' : null" @click="navigate('settings')"><Icon name="settings" /><span class="nav-label" aria-hidden="true">{{ t('settings') }}</span></button>
      </aside>
      <div class="workspace">
        <header class="titlebar" @dblclick.self="store.maximize()">
          <div class="window-title">{{ t('appName') }} <span class="beta-tag">Beta</span></div>
          <div class="titlebar-actions">
            <div class="titlebar-status" :title="t(state.admin ? 'admin' : 'noadmin')"><Icon v-if="state.admin" name="shield" /><span class="status-dot" :class="{ running: state.running, busy: state.transition }"></span><span class="status-label">{{ t(state.transition || (state.running ? 'running' : 'stopped')) }}</span><button v-if="state.config && state.config.noupdate" type="button" class="update-status" :title="t('pluginUpdatesDisabled')" :aria-label="t('pluginUpdatesDisabled')" @click="enableUpdate('noupdate')"><Icon name="syncOff" /><span class="update-status-label">{{ t('pluginUpdates') }}</span></button><button v-if="state.config && state.config.noselfupdate" type="button" class="update-status" :title="t('toolboxUpdatesDisabled')" :aria-label="t('toolboxUpdatesDisabled')" @click="enableUpdate('noselfupdate')"><Icon name="syncOff" /><span class="update-status-label">{{ t('toolboxUpdates') }}</span></button></div>
            <ProxyButton v-if="page !== 'home'" class="global-proxy" compact :store="store" :state="state" :t="t" />
            <div class="window-controls"><button :title="t('minimize')" :aria-label="t('minimize')" @click="store.send(state.config && state.config.gui.minimizetotray ? 'hide' : 'minimize')"><Icon name="minimize" /></button><button :title="t('maximize')" :aria-label="t('maximize')" :aria-pressed="state.maximized" @click="store.maximize()"><Icon :name="state.maximized ? 'restore' : 'maximize'" /></button><button class="close-window" :title="t('close')" :aria-label="t('close')" @click="store.send('close')"><Icon name="close" /></button></div>
          </div>
        </header>
        <div v-if="!state.config" class="empty-state loading-app"><v-progress-circular indeterminate size="32" width="2" /><p dir="auto">{{ t('loading') }}</p></div>
        <main v-else class="page-container">
          <div v-if="state.updateAvailable && page !== 'home'" class="global-update"><Icon name="download" />{{ t('update') }}</div>
          <transition name="page" :css="!reduced"><component :is="pages[page]" :key="page" v-bind="page === 'settings' ? { initialGroup: settingsGroup } : {}" :store="store" :state="state" :t="t" :search-request="searchRequest" :reduced="reduced" :media-failed="mediaFailed" @appearance-preview="appearancePreview = $event" @navigate="navigate" @help="helpOpen = true" @confirm="confirmation = $event" /></transition>
        </main>
      </div>
    </div>
    <v-dialog transition="toolbox-dialog" :value="!!confirmation" max-width="460" @input="!$event && (confirmation = null)"><section class="dialog-panel"><h2>{{ confirmationCopy.title }}</h2><p dir="auto">{{ confirmationCopy.text }}</p><div class="dialog-actions"><button class="quiet-button" :disabled="!confirmation" @click="confirmation = null">{{ t('cancel') }}</button><button class="solid-button" :disabled="!confirmation" @click="confirmAction">{{ t('confirm') }}</button></div></section></v-dialog>
    <v-dialog transition="toolbox-dialog" :value="!!state.error" max-width="480" @input="!$event && (state.error = '')"><section class="dialog-panel"><h2>{{ t('error') }}</h2><p dir="auto">{{ /^(background|window|server|launcher)-/.test(state.error) ? t(state.error) : state.error }}</p><div class="dialog-actions"><button class="solid-button" @click="state.error = ''">{{ t('ok') }}</button></div></section></v-dialog>
    <v-dialog transition="toolbox-dialog" v-model="helpOpen" max-width="510">
      <section class="dialog-panel help-panel">
        <div class="help-brand"><img :src="'../assets/icon.ico'" alt=""><div><h2>{{ t('appName') }} <span class="beta-tag">Beta</span></h2></div></div>
        <h3>{{ t('editionName') }}</h3><p dir="auto" class="credits-text edition-credit">{{ t('editionCredit') }}</p>
        <h3>{{ t('credits') }}</h3><p dir="auto" class="credits-text">{{ t('creditsText') }}</p>
        <div class="dialog-actions"><button class="quiet-button" @click="helpOpen = false">{{ t('dismiss') }}</button><button class="solid-button" @click="store.send('help')"><Icon name="link" />{{ t('openSupport') }}</button></div>
      </section>
    </v-dialog>
  </v-app>
</template>
<script>
import BackgroundLayer from './components/BackgroundLayer.vue';
import Icon from './components/Icon.vue';
import ProxyButton from './components/ProxyButton.vue';
import HomePage from './pages/HomePage.vue';
import ModsPage from './pages/ModsPage.vue';
import LogsPage from './pages/LogsPage.vue';
import SettingsPage from './pages/SettingsPage.vue';
import { appearanceOf } from '../../ui-config';
import { translator, languageFromArguments, htmlLanguage } from './core/i18n';
const initialLanguage = languageFromArguments(window.process && window.process.argv);
export default {
    components: { BackgroundLayer, Icon, ProxyButton }, props: { store: Object },
    data() { return { state: this.store.state, page: 'home', settingsGroup: 'appearance', pages: { home: HomePage, plugins: ModsPage, logs: LogsPage, settings: SettingsPage }, searchRequest: 0, helpOpen: false, confirmation: null, confirmationCopy: {}, mediaFailed: false, appearancePreview: {}, indicatorTop: null }; },
    computed: {
        appearance() { return { ...appearanceOf(this.state.config), ...this.appearancePreview }; },
        reduced() { return this.appearance.reducedMotion; },
        videoBackground() { return !!(this.state.media && this.state.media.kind === 'video' && !this.state.media.missing && !this.mediaFailed); },
        acrylicEnabled() { return this.appearance.pageAcrylic && !this.videoBackground; },
        appearanceStyle() {
            return {
                '--background-dim': this.appearance.backgroundDim, '--background-opacity': this.appearance.backgroundOpacity,
                '--page-opacity': this.appearance.pageSemiTransparent ? this.appearance.pageOpacity : 1,
                '--frame-opacity': this.appearance.frameOpacity, '--panel-opacity': this.appearance.panelOpacity
            };
        },
        t() { return translator(this.state.config && this.state.config.uilanguage || initialLanguage, window.TeraToolboxMUI); }
    },
    watch: {
        page() { this.$nextTick(this.updateNavigationIndicator); },
        // Retain only display text during dismissal, never a stale confirmation action.
        confirmation(value) { if (value) this.confirmationCopy = { title: value.title, text: value.text }; },
        'state.config': { handler(config) { this.$vuetify.theme.dark = !config || config.gui.theme !== 'light'; document.documentElement.lang = htmlLanguage(config && config.uilanguage || initialLanguage); }, immediate: true },
        'state.media'() { this.mediaFailed = false; }
    },
    mounted() {
        this.navigationObserver = new ResizeObserver(this.updateNavigationIndicator);
        this.navigationObserver.observe(this.$refs.navigation);
        this.updateNavigationIndicator();
        window.addEventListener('keydown', this.keydown); this.store.connect();
    },
    beforeDestroy() { this.navigationObserver.disconnect(); window.removeEventListener('keydown', this.keydown); this.store.dispose(); },
    methods: {
        updateNavigationIndicator() {
            const rail = this.$refs.navigation;
            const selected = rail && rail.querySelector('button.selected');
            // Local offsets stay correct during the window's scale-in animation.
            if (selected) this.indicatorTop = selected.offsetTop + (selected.offsetHeight - 18) / 2;
        },
        navigate(page, group = 'appearance') { this.settingsGroup = group; this.page = page; },
        backgroundFailed() { this.mediaFailed = true; this.store.mediaFailed(); },
        toggleNavigation() { this.store.save({ gui: { appearance: { sidebarExpanded: !this.appearance.sidebarExpanded } } }); },
        enableUpdate(key) {
            if (!this.state.config || !this.state.config[key]) return;
            this.store.save({ [key]: false });
        },
        keydown(event) {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); this.page = 'logs'; this.searchRequest++; }
            if (event.key === 'Escape' && !this.confirmation && !this.helpOpen && !this.state.error && !document.querySelector('.v-menu__content.menuable__content__active')) this.state.logUI.query = '';
        },
        confirmAction() { if (!this.confirmation) return; const action = this.confirmation.action; this.confirmation = null; action(); }
    }
};
</script>

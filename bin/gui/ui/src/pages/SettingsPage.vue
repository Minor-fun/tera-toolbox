<template>
  <section class="page tool-page settings-page" :aria-label="t('settings')">
    <div class="page-heading"><h1>{{ t('settings') }}</h1><button class="quiet-button" @click="$emit('help')"><Icon name="help" />{{ t('help') }}</button></div>
    <div class="settings-layout">
      <nav class="surface settings-categories" :aria-label="t('settings')"><button v-for="item in groups" :key="item" :class="{ selected: group === item }" :aria-current="group === item ? 'page' : null" @click="group = item">{{ t(item) }}<Icon name="right" /></button></nav>
      <select class="settings-category-select" v-model="group" :aria-label="t('settings')"><option v-for="item in groups" :key="item" :value="item">{{ t(item) }}</option></select>
      <div class="settings-scroll">
        <transition name="content" :css="!reduced">
        <section :key="group" class="surface settings-group">
          <h2>{{ t(group) }}</h2>
          <template v-if="group === 'appearance'">
            <SettingRow id="language" :label="t('language')"><select id="language" :value="state.config.uilanguage" @change="store.save({ uilanguage: $event.target.value })"><option v-for="(name, code) in languages" :key="code" :value="code">{{ name }}</option></select></SettingRow>
            <SettingRow id="theme" :label="t('theme')"><div class="segmented theme-selector"><button :class="{ selected: state.config.gui.theme === 'light' }" :aria-pressed="state.config.gui.theme === 'light'" @click="store.save({ gui: { theme: 'light' } })"><Icon name="light" />{{ t('light') }}</button><button :class="{ selected: state.config.gui.theme !== 'light' }" :aria-pressed="state.config.gui.theme !== 'light'" @click="store.save({ gui: { theme: 'dark' } })"><Icon name="dark" />{{ t('dark') }}</button></div></SettingRow>
            <div class="background-setting">
              <div class="background-preview"><img :src="preview" alt="" @error="$event.target.src = './assets/backgrounds/skylight-default.png'"><Icon name="image" /></div>
              <div><h3>{{ t('background') }}</h3><p dir="auto">{{ t('backgroundHint') }}</p><p v-if="state.globalMedia && state.globalMedia.missing" dir="auto" class="caution">{{ t('missingBackground') }}</p><p v-else dir="auto" class="muted">{{ t(appearance.background ? 'customBackground' : 'defaultBackground') }}</p>
                <div class="background-actions">
                  <button v-for="preset in ['image', 'video']" :key="preset" class="quiet-button" :class="{ selected: backgroundChoice === preset }" :data-background-preset="preset" :aria-pressed="backgroundChoice === preset" :disabled="state.mediaBusy" @click="store.background('preset', preset)">{{ t(preset === 'video' ? 'defaultVideo' : 'defaultImage') }}</button>
                  <button class="solid-button" :disabled="state.mediaBusy" @click="store.background('import')"><Icon name="image" />{{ t(state.mediaBusy ? 'importing' : 'import') }}</button>
                </div>
              </div>
            </div>
            <SettingRow id="pageAcrylic" :label="t('pageAcrylic')" :hint="t('pageAcrylicHint')" :value="appearance.pageAcrylic" @change="saveAppearance('pageAcrylic', $event)" />
            <SettingRow id="pageSemiTransparent" :label="t('pageSemiTransparent')" :hint="t('pageSemiTransparentHint')" :value="appearance.pageSemiTransparent" @change="saveAppearance('pageSemiTransparent', $event)" />
            <p dir="auto" class="opacity-hint">{{ t('opacityHint') }}</p>
            <SettingRow v-for="field in opacityControls" :key="field.key" :id="field.key" :label="t(field.key)" :hint="t(field.key + 'Hint')">
              <div class="range-control"><input :id="field.key" type="range" :min="field.min" max="100" step="1" :value="Math.round(appearance[field.key] * 100)" @input="previewAppearance(field.key, Number($event.target.value) / 100)" @change="saveAppearance(field.key, Number($event.target.value) / 100)"><output :for="field.key">{{ Math.round(appearance[field.key] * 100) }}%</output></div>
            </SettingRow>
            <SettingRow id="reducedMotion" :label="t('reducedMotion')" :hint="t('reducedMotionHint')" :value="appearance.reducedMotion" @change="saveAppearance('reducedMotion', $event)" />
          </template>
          <template v-else>
            <div v-if="group === 'game'" class="server-management">
              <div class="server-management-heading"><h3>{{ t('servers') }}</h3><button type="button" class="quiet-button" :disabled="serverDisabled" @click="manageServer('add')">{{ t('addServer') }}</button></div>
              <p dir="auto" class="group-hint">{{ t('serversHint') }}</p>
              <ServerSelector :store="store" :state="state" :t="t" :before-select="saveName" :name-saving="!!nameSave" />
              <p v-if="!server" dir="auto" class="group-hint">{{ t('noServersHint') }}</p>
              <template v-else>
                <SettingRow id="server-name" class="server-field" :label="t('serverName')" :hint="t('serverNameHint')">
                  <input id="server-name" v-model="nameDraft" class="server-input" type="text" dir="auto" maxlength="80" required :disabled="serverDisabled" @blur="saveName" @keydown.enter.prevent="saveName">
                </SettingRow>
                <SettingRow id="launcher-path" class="server-field launcher-setting" :label="t('launcherPath')" :hint="t('launcherPathHint')">
                  <div class="launcher-path-control"><input id="launcher-path" class="server-input" type="text" readonly dir="ltr" :value="server.launcherPath" :title="server.launcherPath" :placeholder="t('noLauncherPath')">
                    <div class="background-actions"><button type="button" class="quiet-button" :disabled="serverDisabled" @click="manageServer('choose-launcher')"><Icon name="folder" />{{ t('chooseLauncher') }}</button><button type="button" class="quiet-button" :disabled="serverDisabled || !server.launcherPath" @click="manageServer('clear-launcher')">{{ t('clearLauncher') }}</button></div>
                  </div>
                </SettingRow>
                <div class="background-setting server-background-setting">
                  <div class="background-preview"><img :src="serverPreviewSource" alt="" @error="serverPreviewFailed = true"><Icon name="image" /></div>
                  <div><h3>{{ t('serverBackground') }}</h3><p dir="auto">{{ t('serverBackgroundHint') }}</p><p v-if="server.backgroundId && (serverPreviewFailed || serverPreview && serverPreview.missing || state.serverBackgroundMissing)" dir="auto" class="caution">{{ t('serverBackgroundMissing') }}</p><p v-else dir="auto" class="muted">{{ t(server.backgroundId ? 'customBackground' : 'useGlobalBackground') }}</p>
                    <div class="background-actions"><button type="button" class="quiet-button" :disabled="serverDisabled" @click="serverBackground('import')">{{ t('chooseServerImage') }}</button><button type="button" class="quiet-button" :disabled="serverDisabled || !server.backgroundId" @click="serverBackground('reset')">{{ t('useGlobalBackground') }}</button></div>
                  </div>
                </div>
                <div class="server-management-footer"><button type="button" class="quiet-button danger-text" :disabled="serverDisabled" @click="removeServer"><Icon name="trash" />{{ t('removeServer') }}</button></div>
              </template>
            </div>
            <p v-if="group === 'startup' || group === 'updates'" dir="auto" class="group-hint">{{ t(group === 'startup' ? 'startupHint' : 'updateHint') }}</p>
            <SettingRow v-for="field in fields[group]" :key="field.key" :id="field.key" :label="t(field.key)" :hint="field.key === 'loghtml' ? t('rawHTMLHint') : ''" :value="!!(field.gui ? state.config.gui[field.key] : state.config[field.key])" @change="saveField(field, $event)" />
            <SettingRow v-if="group === 'startup'" id="startupSound" :label="t('startupSound')" :hint="t('startupSoundHint')" :value="state.config.gui.startupSound !== false" @change="store.save({ gui: { startupSound: $event } })" />
            <form v-if="group === 'startup'" class="window-size-setting" @submit.prevent="applySize">
              <h3>{{ t('windowSize') }}</h3><p dir="auto" class="group-hint">{{ t('windowSizeHint') }}</p>
              <div class="window-size-controls">
                <label for="window-width">{{ t('windowWidth') }}<input id="window-width" v-model.number="sizeDraft.width" type="number" step="1" required :min="sizeLimits.minWidth" :max="sizeLimits.maxWidth"></label>
                <span aria-hidden="true">×</span>
                <label for="window-height">{{ t('windowHeight') }}<input id="window-height" v-model.number="sizeDraft.height" type="number" step="1" required :min="sizeLimits.minHeight" :max="sizeLimits.maxHeight"></label>
                <button class="solid-button" type="submit" :disabled="state.windowSizeBusy || !sizeReady">{{ t('applySize') }}</button>
                <button class="quiet-button" type="button" @click="sizeDraft = { ...defaultSize }">{{ t('defaultSize') }}</button>
              </div>
              <p v-if="sizeReady" dir="auto" class="window-size-range">{{ t('windowSizeRange', sizeLimits) }}</p>
            </form>
          </template>
        </section>
        </transition>
        <p v-if="group === 'startup'" dir="auto" class="settings-footnote">{{ t('windowSaveHint') }}</p>
      </div>
    </div>
  </section>
</template>
<script>
import Icon from '../components/Icon.vue';
import SettingRow from '../components/SettingRow.vue';
import ServerSelector from '../components/ServerSelector.vue';
import { appearanceOf, defaultWindowSize, selectedServerOf } from '../../../ui-config';
export default {
    components: { Icon, SettingRow, ServerSelector }, props: { store: Object, state: Object, t: Function, reduced: Boolean, mediaFailed: Boolean, initialGroup: String },
    data() { return {
        group: this.initialGroup || 'appearance', groups: ['appearance', 'startup', 'logs', 'updates', 'game'], languages: window.languageNames || { en: 'English', zh: '简体中文' }, draft: {},
        nameDraft: '', savedName: '', nameSave: null, serverPreview: null, serverPreviewFailed: false, serverPreviewSequence: 0,
        sizeDraft: { ...defaultWindowSize }, defaultSize: defaultWindowSize, sizeLimits: {}, sizeReady: false,
        fields: {
            startup: [{ key: 'autostart', gui: true }, { key: 'minimizetotray', gui: true }, { key: 'devmode' }],
            logs: [{ key: 'logtimes', gui: true }, { key: 'loghtml', gui: true }, { key: 'cleanstart', gui: true }],
            updates: [{ key: 'updatelog' }, { key: 'noupdate' }, { key: 'noselfupdate' }],
            game: [{ key: 'noslstags' }, { key: 'removecounters' }, { key: 'noserverautojoin' }]
        }
    }; },
    watch: {
        group(value) { if (value === 'startup') this.loadSize(); if (value === 'game') this.loadServerPreview(); },
        server: { immediate: true, handler(value, previous) {
            if (!previous || !value || previous.id !== value.id || this.nameDraft === this.savedName || this.nameDraft.trim() === value.name) this.nameDraft = value && value.name || '';
            this.savedName = value && value.name || '';
            if (this.group === 'game' && (!previous || !value || previous.id !== value.id || previous.backgroundId !== value.backgroundId)) this.loadServerPreview();
        } }
    },
    computed: {
        server() { return selectedServerOf(this.state.config); },
        serverDisabled() { return !!((this.state.serverBusy && !this.nameSave) || this.state.mediaBusy || this.state.transition || this.state.launcherBusy); },
        serverPreviewSource() { return this.serverPreview && !this.serverPreview.missing && !this.serverPreviewFailed ? this.serverPreview.preview : this.preview; },
        appearance() { return { ...appearanceOf(this.state.config), ...this.draft }; },
        backgroundChoice() { return this.appearance.background ? 'custom' : this.appearance.defaultBackground; },
        opacityControls() {
            return [
                ...(this.appearance.pageSemiTransparent ? [{ key: 'pageOpacity', min: 10 }] : []),
                ...['backgroundDim', 'frameOpacity', 'backgroundOpacity', 'panelOpacity'].map(key => ({ key, min: 0 }))
            ];
        },
        preview() { return this.state.globalMedia && !this.state.globalMedia.missing ? this.state.globalMedia.preview : './assets/backgrounds/skylight-default.png'; }
    },
    mounted() { this.store.send('getConfig'); },
    beforeDestroy() { this.serverPreviewSequence++; this.$emit('appearance-preview', {}); },
    methods: {
        async saveName() {
            if (this.nameSave) return this.nameSave;
            if (!this.server || this.nameDraft.trim() === this.server.name || this.serverDisabled) return null;
            this.nameSave = this.store.server('rename', this.server.id, this.nameDraft);
            try { return await this.nameSave; } finally { this.nameSave = null; }
        },
        async manageServer(action) {
            const renamed = await this.saveName();
            if (renamed && (renamed.error || renamed.busy)) return;
            return this.store.server(action, this.server && this.server.id);
        },
        async removeServer() {
            const renamed = await this.saveName();
            if (!this.server || renamed && (renamed.error || renamed.busy)) return;
            const server = { ...this.server };
            this.$emit('confirm', { title: this.t('removeServer'), text: this.t('removeServerQuestion', { serverName: server.name }), action: () => this.store.server('remove', server.id) });
        },
        async loadServerPreview() {
            const sequence = ++this.serverPreviewSequence;
            this.serverPreview = null; this.serverPreviewFailed = false;
            if (!this.server || !this.server.backgroundId) return;
            const result = await this.store.backgroundPreview(this.server.id);
            if (sequence === this.serverPreviewSequence) this.serverPreview = result && result.media || null;
        },
        async serverBackground(action) {
            const renamed = await this.saveName();
            if (!this.server || renamed && (renamed.error || renamed.busy)) return;
            await this.store.background(action, undefined, this.server.id);
            this.loadServerPreview();
        },
        async loadSize() {
            const result = await this.store.windowSize('get');
            if (!result || result.error) return;
            this.sizeLimits = result; this.sizeDraft = { width: result.width, height: result.height }; this.sizeReady = true;
        },
        async applySize() {
            const result = await this.store.windowSize('set', this.sizeDraft.width, this.sizeDraft.height);
            if (result && result.maxWidth) this.sizeLimits = result;
            if (result && !result.error) this.sizeDraft = { width: result.width, height: result.height };
        },
        previewAppearance(key, value) { this.$set(this.draft, key, value); this.$emit('appearance-preview', { ...this.draft }); },
        saveAppearance(key, value) {
            this.store.save({ gui: { appearance: { [key]: value } } });
            this.$delete(this.draft, key);
            this.$emit('appearance-preview', { ...this.draft });
        },
        saveField(field, value) {
            const action = () => this.store.save(field.gui ? { gui: { [field.key]: value } } : { [field.key]: value });
            if (value && ['noupdate', 'noselfupdate'].includes(field.key)) this.$emit('confirm', { title: this.t('warning'), text: this.t(field.key === 'noupdate' ? 'warningMods' : 'warningSelf'), action });
            else action();
        }
    }
};
</script>

<template>
  <section class="page tool-page settings-page" :aria-label="t('settings')">
    <div class="page-heading"><h1>{{ t('settings') }}</h1><button class="quiet-button" @click="$emit('help')"><Icon name="help" />{{ t('help') }}</button></div>
    <div class="settings-layout">
      <nav class="settings-categories" :aria-label="t('settings')"><button v-for="item in groups" :key="item" :class="{ selected: group === item }" :aria-current="group === item ? 'page' : null" @click="group = item">{{ t(item) }}<Icon name="right" /></button></nav>
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
              <div><h3>{{ t('background') }}</h3><p dir="auto">{{ t('backgroundHint') }}</p><p v-if="mediaFailed || state.media && state.media.missing" dir="auto" class="caution">{{ t('missingBackground') }}</p><p v-else dir="auto" class="muted">{{ t(appearance.background ? 'customBackground' : 'defaultBackground') }}</p>
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
            <SettingRow id="reducedMotion" :label="t('reducedMotion')" :hint="t('reducedMotionHint') + (systemReduced ? ' ' + t('systemMotion') : '')" :value="appearance.reducedMotion" @change="saveAppearance('reducedMotion', $event)" />
          </template>
          <template v-else>
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
import { appearanceOf, defaultWindowSize } from '../../../ui-config';
export default {
    components: { Icon, SettingRow }, props: { store: Object, state: Object, t: Function, reduced: Boolean, systemReduced: Boolean, mediaFailed: Boolean },
    data: () => ({
        group: 'appearance', groups: ['appearance', 'startup', 'logs', 'updates', 'game'], languages: window.languageNames || { en: 'English', zh: '简体中文' }, draft: {},
        sizeDraft: { ...defaultWindowSize }, defaultSize: defaultWindowSize, sizeLimits: {}, sizeReady: false,
        fields: {
            startup: [{ key: 'autostart', gui: true }, { key: 'minimizetotray', gui: true }, { key: 'devmode' }],
            logs: [{ key: 'logtimes', gui: true }, { key: 'loghtml', gui: true }, { key: 'cleanstart', gui: true }],
            updates: [{ key: 'updatelog' }, { key: 'noupdate' }, { key: 'noselfupdate' }],
            game: [{ key: 'noslstags' }, { key: 'removecounters' }, { key: 'noserverautojoin' }]
        }
    }),
    watch: { group(value) { if (value === 'startup') this.loadSize(); } },
    computed: {
        appearance() { return { ...appearanceOf(this.state.config), ...this.draft }; },
        backgroundChoice() { return this.appearance.background ? 'custom' : this.appearance.defaultBackground; },
        opacityControls() {
            return [
                ...(this.appearance.pageSemiTransparent ? [{ key: 'pageOpacity', min: 10 }] : []),
                ...['backgroundDim', 'frameOpacity', 'backgroundOpacity', 'panelOpacity'].map(key => ({ key, min: 0 }))
            ];
        },
        preview() { return this.state.media && !this.state.media.missing && !this.mediaFailed ? this.state.media.preview : './assets/backgrounds/skylight-default.png'; }
    },
    mounted() { this.store.send('getConfig'); },
    beforeDestroy() { this.$emit('appearance-preview', {}); },
    methods: {
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

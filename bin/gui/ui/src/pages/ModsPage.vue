<template>
  <section class="page tool-page mods-page" :aria-label="t('plugins')">
    <div class="page-heading"><h1>{{ t('plugins') }}</h1><button class="quiet-button" @click="store.send('folder')"><Icon name="folder" />{{ t('folder') }}</button></div>
    <div class="surface mods-surface">
      <div class="mods-toolbar">
        <div class="segmented" role="tablist" :aria-label="t('plugins')">
          <button role="tab" :aria-selected="tab === 'installed'" :class="{ selected: tab === 'installed' }" @click="selectTab('installed')">{{ t('installed') }} <span>{{ state.mods.length }}</span></button>
          <button role="tab" :aria-selected="tab === 'browse'" :class="{ selected: tab === 'browse' }" @click="selectTab('browse')">{{ t('browse') }}</button>
        </div>
        <button class="icon-button" :title="t('refresh')" :aria-label="t('refresh')" :disabled="state.modBusy" @click="refresh"><Icon name="refresh" /></button>
      </div>
      <div class="filter-row">
        <label class="search-field"><Icon name="search" /><input v-model="query" :placeholder="t('searchPlugins')" :aria-label="t('searchPlugins')"><button v-if="query" class="icon-button" :aria-label="t('clear')" @click="query = ''"><Icon name="close" /></button></label>
        <select v-model="category" :aria-label="t('all')"><option value="all">{{ t('all') }}</option><option value="network">{{ t('network') }}</option><option value="client">{{ t('client') }}</option><option v-if="tab === 'installed'" value="legacy">{{ t('legacy') }}</option><option v-if="tab === 'installed'" value="core">{{ t('core') }}</option></select>
      </div>
      <p dir="auto" class="inline-note" :class="{ caution: state.running || state.transition }">{{ t(state.running || state.transition ? 'modLocked' : 'applyNext') }}</p>
      <div class="mods-scroll">
        <transition name="content" :css="!reduced">
        <div :key="tab" class="mods-content">
        <div v-if="!loaded" class="empty-state"><v-progress-circular indeterminate size="28" width="2" /><p dir="auto">{{ t('loading') }}</p></div>
        <div v-else-if="!filtered.length" class="empty-state"><Icon name="plugins" /><p dir="auto">{{ t('noPlugins') }}</p></div>
        <div v-else class="plugin-list" :class="tab === 'browse' ? 'available-list' : 'installed-list'">
          <article v-for="mod in filtered" :key="mod.name" class="plugin-item" :class="{ 'configured-disabled': mod.disabled }">
            <div class="plugin-copy">
              <div class="plugin-heading">
                <h2 class="plugin-name" :title="displayName(mod)">{{ displayName(mod) }}</h2>
                <span v-if="mod.version" class="plugin-version" :title="t('version') + ': ' + mod.version">{{ mod.version }}</span>
                <span v-if="mod.author" class="plugin-author" :title="t('author') + ': ' + mod.author">{{ mod.author }}</span>
                <span v-if="mod.isCoreModule" class="tag core-tag">{{ t('core') }}</span>
                <span v-else-if="mod.compatibility === 'legacy'" class="tag" :title="t('legacyHint')">{{ t('legacy') }}</span>
              </div>
              <p v-if="mod.description" class="plugin-description" :title="mod.description">{{ mod.description }}</p>
            </div>
            <div class="plugin-actions">
              <label v-if="tab === 'installed' && !mod.isCoreModule && mod.compatibility === 'compatible'" class="plugin-action plugin-toggle" :class="{ 'is-on': !mod.disabled, 'control-disabled': !canAct(mod, 'toggle', state) }" :title="t('enablePlugin') + ': ' + t(mod.disabled ? 'disabled' : 'enabled') + '\n' + t('applyNext')">
                <input class="plugin-enable" type="checkbox" :checked="!mod.disabled" :disabled="!canAct(mod, 'toggle', state)" :aria-label="displayName(mod) + ' ' + t('enablePlugin')" @change="store.act(mod, 'toggle')"><Icon name="power" /><Icon v-if="!mod.disabled" class="toggle-check" name="check" />
              </label>
              <button v-if="mod.readmePath" class="plugin-action plugin-readme" :title="t('readme')" :aria-label="displayName(mod) + ' ' + t('readme')" @click="store.send('readme', mod.readmePath)"><Icon name="info" /></button>
              <button v-if="mod.supportUrl" class="plugin-action" :title="t('support')" :aria-label="displayName(mod) + ' ' + t('support')" @click="store.openLink(mod.supportUrl)"><Icon name="link" /></button>
              <button v-if="mod.donationUrl" class="plugin-action" :title="t('donate')" :aria-label="displayName(mod) + ' ' + t('donate')" @click="store.openLink(mod.donationUrl)"><Icon name="heart" /></button>
              <label v-if="tab === 'installed' && !mod.isCoreModule && mod.compatibility === 'compatible'" class="plugin-action plugin-toggle update-toggle" :class="{ 'is-on': !mod.disableAutoUpdate, 'control-disabled': !canAct(mod, 'autoupdate', state) }" :title="t('autoUpdate') + ': ' + t(mod.disableAutoUpdate ? 'off' : 'on')">
                <input class="plugin-autoupdate" type="checkbox" :checked="!mod.disableAutoUpdate" :disabled="!canAct(mod, 'autoupdate', state)" :aria-label="displayName(mod) + ' ' + t('autoUpdate')" @change="store.act(mod, 'autoupdate')"><Icon :name="mod.disableAutoUpdate ? 'syncOff' : 'sync'" />
              </label>
              <button v-if="tab === 'installed' && !mod.isCoreModule" class="plugin-action plugin-uninstall" :title="t('uninstall')" :aria-label="displayName(mod) + ' ' + t('uninstall')" :disabled="!canAct(mod, 'uninstall', state)" @click="askUninstall(mod)"><Icon name="trash" /></button>
              <button v-if="tab === 'browse'" class="plugin-action install-button" :title="t('install')" :aria-label="displayName(mod) + ' ' + t('install')" :disabled="!canAct(mod, 'install', state)" @click="store.act(mod, 'install')"><Icon name="install" /></button>
            </div>
          </article>
        </div>
        </div>
        </transition>
      </div>
    </div>
  </section>
</template>
<script>
import Icon from '../components/Icon.vue';
import { displayName, canAct } from '../core/controller';
export default {
    components: { Icon }, props: { store: Object, state: Object, t: Function, reduced: Boolean },
    data: () => ({ tab: 'installed', category: 'all', query: '' }),
    computed: {
        loaded() { return this.tab === 'installed' ? this.state.modsLoaded : this.state.availableLoaded; },
        filtered() {
            const queries = this.query.toLocaleLowerCase().split(',').map(value => value.trim()).filter(Boolean);
            return (this.tab === 'installed' ? this.state.mods : this.state.available).filter(mod => {
                const keywords = mod.keywords || [];
                if (this.category === 'legacy' && mod.compatibility !== 'legacy') return false;
                if (this.category === 'core' && !mod.isCoreModule) return false;
                if (['network', 'client'].includes(this.category) && !keywords.includes(this.category)) return false;
                const text = [displayName(mod), mod.name, mod.author, mod.description, ...keywords].join(' ').toLocaleLowerCase();
                return !queries.length || queries.some(query => text.includes(query));
            });
        }
    },
    mounted() { this.store.send('mods'); },
    methods: {
        displayName, canAct,
        refresh() { this.store.send(this.tab === 'installed' ? 'mods' : 'available'); },
        selectTab(tab) { this.tab = tab; this.category = 'all'; this.refresh(); },
        askUninstall(mod) { this.$emit('confirm', { title: this.t('uninstall'), text: this.t('uninstallQuestion', { name: displayName(mod) }), action: () => this.store.act(mod, 'uninstall') }); }
    }
};
</script>

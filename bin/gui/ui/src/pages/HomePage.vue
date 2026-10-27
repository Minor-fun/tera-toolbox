<template>
  <section class="home-page page" :aria-label="t('home')">
    <div v-if="state.updateAvailable" class="update-notice"><Icon name="download" />{{ t('update') }}</div>
    <aside class="quick-actions" :aria-label="t('shortcuts')">
      <button :aria-label="t('folder')" :data-tooltip="t('folder')" @click="store.send('folder')"><Icon name="folder" /></button>
      <button :aria-label="t('help')" :data-tooltip="t('help')" @click="$emit('help')"><Icon name="help" /></button>
      <button :aria-label="t('export')" :data-tooltip="t('export')" @click="store.exportLogs()"><Icon name="download" /></button>
    </aside>
    <div class="home-layout">
      <section class="home-information surface">
        <div class="home-summary">
          <div class="status-line"><span class="status-dot" :class="{ running: state.running, busy: state.transition }"></span><span>{{ t(state.transition || (state.running ? 'running' : 'stopped')) }}</span></div>
          <h1 v-if="!state.running && !state.transition">{{ t('ready') }}</h1>
          <div class="configuration-count" :title="t('configurationOnly')"><span>{{ t('installedCount', { count: state.mods.length }) }}</span><span class="small-divider"></span><span>{{ t('enabledCount', { count: enabled }) }}</span></div>
          <p dir="auto" class="home-hint">{{ t(state.transition ? state.transition + 'Hint' : state.running ? 'runningHint' : 'stoppedHint') }}</p>
        </div>
        <div class="recent-heading"><button ref="drawerToggle" class="text-button recent-toggle" :aria-expanded="logsOpen" aria-controls="home-recent-drawer" @click="logsOpen = !logsOpen">{{ t('recent') }}<Icon name="right" /></button><button class="text-button" @click="$emit('navigate', 'logs')">{{ t('allLogs') }}<Icon name="right" /></button></div>
        <transition name="log-drawer" :css="!reduced">
        <div v-show="logsOpen" id="home-recent-drawer" class="recent-drawer">
        <div ref="recentLogs" class="recent-logs" tabindex="0" :aria-label="t('recent')" @scroll="followLogs = $event.target.scrollHeight - $event.target.scrollTop - $event.target.clientHeight < 8">
          <div v-for="entry in recent" :key="entry.id" :class="'log-' + entry.type">{{ entry.plain.trim() }}</div>
          <p v-if="!recent.length" dir="auto" class="empty-recent">{{ t('noLogs') }}</p>
        </div>
        </div>
        </transition>
        <div class="startup-heading" :class="{ 'startup-failed': progress.phase === 'failed' }">
          <span><span class="startup-label">{{ t('startupProgress') }}</span><span class="startup-phase" role="status">{{ t(state.transition === 'stopping' ? 'stopping' : 'startup-' + progress.phase) }}<span v-if="currentPlugin"> · {{ currentPlugin }}</span></span></span>
          <strong class="startup-percent">{{ progress.percent }}<span>%</span></strong>
        </div>
        <div class="startup-track" :class="{ 'startup-failed': progress.phase === 'failed' }" role="progressbar" :aria-label="t('startupProgress')" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="progress.percent" :aria-valuetext="progress.percent + '% ' + t('startup-' + progress.phase)">
          <div class="startup-fill" :style="{ width: progress.percent + '%' }"></div>
        </div>
        <div v-if="progress.total !== undefined" class="preload-counts"><span>{{ t('preloadCount', progress) }}</span><span>{{ t('preloadLoaded', progress) }}</span><span v-if="progress.failed" class="danger-text">{{ t('preloadFailed', progress) }}</span><span v-if="progress.skipped" class="caution">{{ t('preloadSkipped', progress) }}</span></div>
        <div v-if="progress.phase === 'updating' && progress.update" class="preload-counts update-counts"><span>{{ t('updateCount', progress.update) }}</span><span v-if="progress.update.filesTotal" :title="progress.update.file">{{ t('updateFiles', progress.update) }}</span><span v-if="progress.update.skipped">{{ t('updateSkipped', progress.update) }}</span></div>
        <div v-if="progress.updateError || progress.update && progress.update.failed" class="preload-counts caution update-failures"><span>{{ progress.updateError ? t('updateError') : t('updateFailed', progress.update) }}</span></div>
      </section>
      <section class="home-actions">
        <ProxyButton :store="store" :state="state" :t="t" />
      </section>
    </div>
  </section>
</template>
<script>
import Icon from '../components/Icon.vue';
import ProxyButton from '../components/ProxyButton.vue';
export default {
    components: { Icon, ProxyButton }, props: { store: Object, state: Object, t: Function, reduced: Boolean },
    data() { return { followLogs: true, logsOpen: this.state.transition === 'starting' || this.state.startupProgress.phase === 'failed' }; },
    computed: {
        progress() { return this.state.startupProgress; },
        currentPlugin() { return this.progress.phase === 'updating' ? this.progress.update && this.progress.update.current : this.progress.phase === 'preloading' ? this.progress.current : ''; },
        enabled() { return this.state.mods.filter(mod => !mod.disabled).length; },
        recent() { void this.state.logVersion; return this.store.logs.entries.slice(-3); }
    },
    watch: {
        'state.logVersion'() { if (this.followLogs) this.$nextTick(this.scrollLogs); },
        'state.transition'(value) { if (value === 'starting') this.logsOpen = true; },
        'progress.phase'(value) {
            if (value === 'failed') this.logsOpen = true;
            if (value === 'ready') this.logsOpen = false;
        },
        logsOpen(value) {
            if (value) { this.followLogs = true; this.$nextTick(this.scrollLogs); }
            else if (this.$refs.recentLogs.contains(document.activeElement)) this.$refs.drawerToggle.focus();
        }
    },
    mounted() {
        this.logsObserver = new ResizeObserver(() => { if (this.followLogs) this.scrollLogs(); });
        this.logsObserver.observe(this.$refs.recentLogs);
        this.$nextTick(this.scrollLogs);
    },
    beforeDestroy() { this.logsObserver.disconnect(); },
    methods: { scrollLogs() { const box = this.$refs.recentLogs; if (box) box.scrollTop = box.scrollHeight; } }
};
</script>

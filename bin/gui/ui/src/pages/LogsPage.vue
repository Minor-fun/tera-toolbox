<template>
  <section class="page tool-page logs-page" :aria-label="t('logs')">
    <div class="page-heading"><div class="logs-heading-copy"><h1>{{ t('logs') }}</h1><span class="muted">{{ t('logCount', { count: layout.length }) }}</span></div><button class="quiet-button" @click="store.send('folder')"><Icon name="folder" />{{ t('folder') }}</button></div>
    <div class="surface log-surface">
      <div class="log-toolbar">
        <label class="search-field log-search"><Icon name="search" /><input ref="search" v-model="state.logUI.query" :placeholder="t('searchLogs')" :aria-label="t('searchLogs')" @keydown="searchKey"><span v-if="state.logUI.query" class="search-count">{{ matches.length ? current + 1 : 0 }}/{{ matches.length }}{{ matches.length === 50000 ? '+' : '' }}</span></label>
        <div class="toolbar-group">
          <button class="icon-button" :aria-label="t('previous')" :title="t('previous')" :disabled="!matches.length" @click="move(-1)"><Icon name="up" /></button>
          <button class="icon-button" :aria-label="t('next')" :title="t('next')" :disabled="!matches.length" @click="move(1)"><Icon name="next" /></button>
          <button class="icon-button" :aria-label="t('clearSearch')" :title="t('clearSearch')" :disabled="!state.logUI.query" @click="closeSearch"><Icon name="close" /></button>
        </div>
        <div class="toolbar-group log-tools">
          <button class="quiet-button" :class="{ selected: state.logUI.paused }" :aria-pressed="state.logUI.paused" @click="togglePause"><Icon :name="state.logUI.paused ? 'play' : 'pause'" /><span>{{ t(state.logUI.paused ? 'resume' : 'pause') }}</span></button>
          <button class="quiet-button" @click="store.exportLogs()"><Icon name="download" /><span>{{ t('export') }}</span></button>
          <button class="quiet-button" @click="store.clearLogs()"><Icon name="trash" /><span>{{ t('clear') }}</span></button>
        </div>
      </div>
      <div v-if="!layout.length" class="empty-state log-empty"><Icon name="logs" /><h2>{{ t('logEmpty') }}</h2><p dir="auto">{{ t('logEmptyHint') }}</p></div>
      <div v-else ref="viewport" class="log-viewport" tabindex="0" :aria-label="t('logs')" @scroll="onScroll" @click="onLogLink">
        <div class="log-canvas" :style="{ height: totalHeight + 'px' }">
          <div v-for="row in visibleRows" :key="row.entry.id" :data-log-id="row.entry.id" :class="['log-entry', 'log-' + row.entry.type]" :style="{ top: row.top + 'px', minHeight: row.height + 'px' }" v-html="renderRow(row.entry)"></div>
        </div>
      </div>
      <div class="log-footer"><span>{{ state.logUI.paused ? t('pause') : t('resume') }}</span><span v-if="dropped" class="caution">{{ t('dropped', { count: dropped }) }}</span><span v-else>Ctrl+F · Enter · Shift+Enter · Esc</span></div>
    </div>
  </section>
</template>
<script>
import Icon from '../components/Icon.vue';
import { findMatches, highlight, escapeHTML } from '../core/logs';
const lineHeight = 22;
export default {
    components: { Icon }, props: { store: Object, state: Object, t: Function, searchRequest: Number },
    data: () => ({ scrollTop: 0, viewportHeight: 500, resizeObserver: null }),
    computed: {
        rawHTML() { return !!this.state.config.gui.loghtml; },
        entries() { void this.state.logVersion; return this.store.logs.entries; },
        dropped() { void this.state.logVersion; return this.store.logs.dropped; },
        layout() {
            let top = 0;
            return this.entries.map(entry => {
                const text = (this.rawHTML ? entry.raw : entry.plain).replace(/\r?\n$/, '');
                const height = Math.max(1, text.split('\n').length) * lineHeight;
                const row = { entry, top, height };
                top += height;
                return row;
            });
        },
        totalHeight() { const last = this.layout[this.layout.length - 1]; return last ? last.top + last.height + 16 : 0; },
        visibleRows() {
            let low = 0, high = this.layout.length;
            const start = Math.max(0, this.scrollTop - 120);
            while (low < high) {
                const middle = (low + high) >> 1;
                if (this.layout[middle].top + this.layout[middle].height < start) low = middle + 1;
                else high = middle;
            }
            let end = low;
            while (end < this.layout.length && this.layout[end].top < this.scrollTop + this.viewportHeight + 120) end++;
            return this.layout.slice(low, end);
        },
        matches() { return findMatches(this.entries, this.state.logUI.query, this.rawHTML); },
        current() { return Math.min(this.state.logUI.current, Math.max(0, this.matches.length - 1)); }
    },
    watch: {
        'state.logVersion'() { this.$nextTick(() => { this.observeViewport(); if (!this.state.logUI.paused) this.toBottom(); }); },
        'state.logUI.query'(query) { this.state.logUI.current = 0; if (query) { this.state.logUI.paused = true; this.$nextTick(this.revealMatch); } },
        rawHTML() { this.state.logUI.query = ''; this.$nextTick(this.observeViewport); },
        searchRequest() { this.focusSearch(); }
    },
    mounted() {
        this.resizeObserver = new ResizeObserver(() => {
            if (this.$refs.viewport) this.viewportHeight = this.$refs.viewport.clientHeight;
        });
        this.observeViewport();
        this.$nextTick(() => {
            if (!this.state.logUI.paused) this.toBottom();
            else if (this.$refs.viewport) this.$refs.viewport.scrollTop = this.state.logUI.scrollTop || 0;
            if (this.searchRequest) this.focusSearch();
        });
    },
    beforeDestroy() { this.resizeObserver.disconnect(); },
    methods: {
        observeViewport() {
            if (!this.$refs.viewport) return;
            this.resizeObserver.disconnect();
            this.resizeObserver.observe(this.$refs.viewport);
            this.viewportHeight = this.$refs.viewport.clientHeight;
        },
        renderRow(entry) {
            const query = this.state.logUI.query;
            const active = this.matches[this.current];
            if (query) return highlight((this.rawHTML ? entry.raw : entry.plain).replace(/\r?\n$/, ''), query, active && active.id === entry.id ? active.position : -1);
            return (this.rawHTML ? escapeHTML(entry.raw) : entry.html).replace(/\r?\n$/, '');
        },
        onScroll(event) { this.scrollTop = event.target.scrollTop; this.state.logUI.scrollTop = this.scrollTop; },
        toBottom() { if (this.$refs.viewport) { this.$refs.viewport.scrollTop = this.totalHeight; this.scrollTop = this.$refs.viewport.scrollTop; } },
        togglePause() { this.state.logUI.paused = !this.state.logUI.paused; if (!this.state.logUI.paused) this.$nextTick(this.toBottom); },
        focusSearch() { this.$nextTick(() => { this.$refs.search.focus(); this.$refs.search.select(); }); },
        closeSearch() { this.state.logUI.query = ''; this.$refs.search.blur(); },
        searchKey(event) {
            if (event.key === 'Enter') { event.preventDefault(); this.move(event.shiftKey ? -1 : 1); }
            if (event.key === 'Escape') { event.preventDefault(); this.closeSearch(); }
        },
        move(step) {
            if (!this.matches.length) return;
            this.state.logUI.current = (this.current + step + this.matches.length) % this.matches.length;
            this.revealMatch();
        },
        revealMatch() {
            const match = this.matches[this.current];
            if (!match || !this.$refs.viewport) return;
            const text = this.rawHTML ? this.entries[match.row].raw : this.entries[match.row].plain;
            const lineOffset = (text.slice(0, match.position).match(/\n/g) || []).length * lineHeight;
            this.$refs.viewport.scrollTop = Math.max(0, this.layout[match.row].top + lineOffset - this.viewportHeight / 2);
            this.scrollTop = this.$refs.viewport.scrollTop;
            this.$nextTick(() => {
                const viewport = this.$refs.viewport;
                const mark = viewport && viewport.querySelector('.current-match');
                if (!mark) return;
                const found = mark.getBoundingClientRect();
                const bounds = viewport.getBoundingClientRect();
                if (found.left < bounds.left || found.right > bounds.right) viewport.scrollLeft += found.left - bounds.left - bounds.width / 2;
            });
        },
        onLogLink(event) {
            const link = event.target.closest('a');
            if (!link) return;
            event.preventDefault();
            this.store.openLink(link.getAttribute('href'));
        }
    }
};
</script>

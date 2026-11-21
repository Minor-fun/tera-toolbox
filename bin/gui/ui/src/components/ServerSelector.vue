<template>
  <div :class="badge ? 'server-badge-anchor' : 'server-selector'">
    <template v-if="badge">
      <v-menu v-if="switchable" v-model="open" light top left offset-y :nudge-top="8" :min-width="200" :max-width="264" :max-height="240" :disabled="disabled" :transition="reduced ? false : 'toolbox-menu'" content-class="server-menu" :content-props="{ 'aria-label': t('switchServer') }">
        <template #activator="{ on, attrs }">
          <button ref="badgeButton" type="button" class="server-badge server-badge-button" :disabled="disabled" :title="label" :aria-label="t('switchServer') + ': ' + label" v-bind="attrs" v-on="on"><span class="server-badge-name" dir="auto">{{ label }}</span><Icon name="down" /></button>
        </template>
        <v-list light dense class="server-options" role="presentation">
          <v-list-item v-for="server in profiles" :id="'server-option-' + server.id" :key="server.id" tag="button" type="button" class="server-option" color="var(--chrome-ink)" :input-value="selected && selected.id === server.id" :disabled="disabled" role="menuitemradio" :aria-checked="selected && selected.id === server.id" :title="server.name" @click="select(server.id)"><span class="server-option-name" dir="auto">{{ server.name || t('serverDefault') }}</span><Icon v-if="selected && selected.id === server.id" name="check" /></v-list-item>
        </v-list>
      </v-menu>
      <span v-else class="server-badge" :title="label"><span class="server-badge-name" dir="auto">{{ label }}</span></span>
    </template>
    <select v-else :value="selected && selected.id" :aria-label="t('selectedServer')" :title="selected && selected.name" :disabled="disabled || !profiles.length" @change="select($event.target.value)">
      <option v-if="!profiles.length" value="">{{ t('noServers') }}</option>
      <option v-for="server in profiles" :key="server.id" :value="server.id">{{ server.name || t('serverDefault') }}</option>
    </select>
  </div>
</template>
<script>
import Icon from './Icon.vue';
import { serverProfilesOf, selectedServerOf } from '../../../ui-config';
export default {
    components: { Icon }, props: { store: Object, state: Object, t: Function, badge: Boolean, reduced: Boolean, beforeSelect: Function, nameSaving: Boolean },
    data() { return { open: false }; },
    computed: {
        profiles() { return serverProfilesOf(this.state.config); },
        selected() { return selectedServerOf(this.state.config); },
        label() { return this.selected ? this.selected.name || this.t('serverDefault') : this.t('serverPending'); },
        switchable() { return this.badge && this.profiles.length > 1; },
        disabled() { return !!(this.state.transition || this.state.launcherBusy || (this.state.serverBusy && !this.nameSaving) || this.state.mediaBusy); }
    },
    watch: {
        disabled(value) { if (value) this.open = false; },
        switchable(value) { if (!value) this.open = false; }
    },
    methods: {
        async select(id) {
            if (this.beforeSelect) {
                const result = await this.beforeSelect();
                if (result && (result.error || result.busy)) return;
            }
            if (this.disabled) return;
            this.open = false;
            const result = this.selected && this.selected.id === id ? null : await this.store.server('select', id);
            if (this.badge && !this._isDestroyed && !(result && (result.error || result.busy))) this.$nextTick(() => {
                if (this.$refs.badgeButton) this.$refs.badgeButton.focus();
            });
            return result;
        }
    }
};
</script>

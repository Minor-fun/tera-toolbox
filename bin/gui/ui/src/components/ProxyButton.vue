<template>
  <button class="proxy-button" :class="{ compact, 'is-running': state.running }" :aria-busy="busy" :disabled="!state.config || busy || state.serverBusy || (home && state.mediaBusy)" @click="store.toggleProxy(home)">
    <transition name="symbol"><span :key="state.transition || (busy ? 'launcher' : state.running ? 'running' : 'stopped')" class="proxy-symbol" aria-hidden="true"><Icon v-if="busy" name="sync" class="button-spinner" /><Icon v-else :name="state.running ? 'stop' : 'play'" /></span></transition>
    <span class="proxy-copy">{{ t(state.transition || (home && state.launcherBusy ? 'openingLauncher' : state.running ? 'stop' : 'start')) }}</span>
  </button>
</template>
<script>
import Icon from './Icon.vue';
export default {
    components: { Icon }, props: { store: Object, state: Object, t: Function, compact: Boolean, home: Boolean },
    computed: {
        busy() { return !!(this.state.transition || (this.home && this.state.launcherBusy)); }
    }
};
</script>

<template>
  <button class="proxy-button" :class="{ compact, 'is-running': state.running }" :aria-busy="!!state.transition" :disabled="!state.config || !!state.transition" @click="store.toggleProxy()">
    <transition name="symbol"><span :key="state.transition || (state.running ? 'running' : 'stopped')" class="proxy-symbol" aria-hidden="true"><Icon v-if="state.transition" name="sync" class="button-spinner" /><Icon v-else :name="state.running ? 'stop' : 'play'" /></span></transition>
    <span>{{ t(state.transition || (state.running ? 'stop' : 'start')) }}</span>
  </button>
</template>
<script>
import Icon from './Icon.vue';
export default { components: { Icon }, props: { store: Object, state: Object, t: Function, compact: Boolean } };
</script>

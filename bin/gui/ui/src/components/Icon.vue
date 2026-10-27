<template><svg class="ui-icon" :viewBox="icon.viewBox" aria-hidden="true" focusable="false"><path v-for="(path, index) in icon.paths" :key="index" :d="path" /></svg></template>
<script>
import symbols from './material-symbols.json';
export default {
    name: 'Icon', props: { name: String },
    computed: { icon() { return symbols[this.name] || symbols.plugins; } }
};
</script>

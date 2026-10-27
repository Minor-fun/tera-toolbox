<template>
  <div class="setting-row">
    <div class="setting-copy"><label dir="auto" :for="id">{{ label }}</label><p v-if="hint" dir="auto">{{ hint }}</p></div>
    <div class="setting-control"><slot><label class="switch"><input :id="id" type="checkbox" :checked="!!value" :aria-label="label" @change="change"><span aria-hidden="true"></span></label></slot></div>
  </div>
</template>
<script>
export default {
    props: { id: String, label: String, hint: String, value: Boolean },
    methods: { change(event) { const value = event.target.checked; event.target.checked = !!this.value; this.$emit('change', value); } }
};
</script>

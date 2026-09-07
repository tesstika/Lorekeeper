<script setup lang="ts" vapor>
// Button-based switch: native checkbox v-model is unreliable under Vapor interop
// (the model→DOM effect desyncs), and a role="switch" button is fully accessible.
defineProps<{ label: string; modelValue: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>();
</script>

<template>
  <button
    type="button"
    role="switch"
    :aria-checked="modelValue"
    :aria-label="label"
    class="relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors"
    :class="modelValue ? 'bg-primary-container' : 'bg-surface-container-highest'"
    @click="emit('update:modelValue', !modelValue)"
  >
    <span
      class="absolute top-[2px] left-[2px] h-5 w-5 rounded-full transition-transform"
      :class="modelValue ? 'translate-x-full bg-surface-container-lowest' : 'bg-on-primary-container'"
    ></span>
  </button>
</template>

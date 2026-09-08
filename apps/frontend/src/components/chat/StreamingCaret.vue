<script setup lang="ts" vapor>
withDefaults(defineProps<{ blinkMs?: number }>(), { blinkMs: 500 });
</script>

<template>
  <span
    class="lk-caret"
    :style="{ '--lk-caret-blink': `${blinkMs}ms` }"
    aria-hidden="true"
  />
</template>

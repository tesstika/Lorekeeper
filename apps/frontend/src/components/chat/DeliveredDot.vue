<script setup lang="ts" vapor>
import { onBeforeUnmount, ref } from 'vue';

const props = withDefaults(
  defineProps<{
    tone?: 'stop' | 'aborted' | 'error';
    blinkMs?: number;
    blinks?: number;
  }>(),
  { tone: 'stop', blinkMs: 250, blinks: 6 },
);

const visible = ref(true);
let timer: ReturnType<typeof setTimeout> | null = null;

// Stage B (§6.7): blink exactly `blinks` × `blinkMs`, then fade out and go away.
timer = setTimeout(
  () => {
    visible.value = false;
  },
  props.blinkMs * props.blinks + 600,
);

onBeforeUnmount(() => {
  if (timer) clearTimeout(timer);
});
</script>

<template>
  <span
    v-if="visible"
    class="lk-delivered"
    :class="{
      'lk-delivered-stop': tone === 'stop',
      'lk-delivered-aborted': tone === 'aborted',
      'lk-delivered-error': tone === 'error',
    }"
    :style="{ '--lk-delivered-ms': `${blinkMs}ms`, '--lk-delivered-n': `${blinks}` }"
    aria-hidden="true"
  />
</template>

<script setup lang="ts">
// Classic VDOM shell (decision D4): RouterView interops with the Vapor pages.
import { computed, onMounted } from 'vue';
import BackgroundAtmosphere from '@/components/ui/BackgroundAtmosphere.vue';
import { useSettingsStore } from '@/stores/settings';

const settingsStore = useSettingsStore();
onMounted(() => {
  // Shell-level settings load so the background effect renders on every route
  // without waiting for a page-level load() (idempotent — cached afterwards).
  void settingsStore.load();
});
const backgroundEffect = computed(() => settingsStore.display.backgroundEffect);
</script>

<template>
  <!-- `isolate` makes this shell a stacking context: the atmosphere paints at
       z-index -10 above the shell background but below every page surface. -->
  <div class="isolate min-h-dvh bg-background text-on-surface">
    <BackgroundAtmosphere :effect="backgroundEffect" />
    <RouterView />
  </div>
</template>

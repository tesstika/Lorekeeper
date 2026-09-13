<script setup lang="ts" vapor>
import type { BackgroundEffect } from '@lorekeeper/shared';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

/**
 * Atmospheric background underlay (fixed, full-screen, behind the router
 * view). Pure CSS transform/opacity keyframes (styles live in tailwind.css);
 * no canvas, no particle libraries. Particle density stays deliberately low
 * (18 embers / 3 aurora blobs / 45 stars) and every element is a 2–3 px
 * compositor-driven layer.
 *
 * Battery/GPU discipline:
 * - `off` renders nothing at all (zero DOM elements).
 * - `document.visibilitychange` unmounts the particles while the tab is
 *   hidden and re-renders them (fresh random field) when it returns.
 * - `prefers-reduced-motion: reduce` unmounts the particles entirely — the
 *   CSS media block in tailwind.css is the backstop for a missed query.
 */
const props = defineProps<{ effect: BackgroundEffect }>();

const EMBER_COUNT = 18;
const STAR_COUNT = 45;

const documentHidden = ref(document.hidden);
const reducedMotion = ref(false);

function handleVisibilityChange(): void {
  documentHidden.value = document.hidden;
}

let motionQuery: MediaQueryList | null = null;
function handleMotionChange(event: MediaQueryListEvent): void {
  reducedMotion.value = event.matches;
}

onMounted(() => {
  documentHidden.value = document.hidden;
  document.addEventListener('visibilitychange', handleVisibilityChange);
  // jsdom (component tests) has no matchMedia — degrade to "motion allowed".
  if (typeof window.matchMedia === 'function') {
    motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    reducedMotion.value = motionQuery.matches;
    motionQuery.addEventListener('change', handleMotionChange);
  }
});

onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  motionQuery?.removeEventListener('change', handleMotionChange);
});

const enabled = computed(
  () => props.effect !== 'off' && !documentHidden.value && !reducedMotion.value,
);

interface Ember {
  left: number;
  duration: number;
  delay: number;
  drift: number;
}
interface Star {
  left: number;
  top: number;
  size: number;
  duration: number;
  delay: number;
}

const embers = computed<Ember[]>(() => {
  if (props.effect !== 'embers' || !enabled.value) return [];
  return Array.from({ length: EMBER_COUNT }, () => ({
    left: Math.random() * 100,
    duration: 9 + Math.random() * 10,
    delay: -Math.random() * 18,
    drift: Math.round(Math.random() * 50 - 25),
  }));
});

const stars = computed<Star[]>(() => {
  if (props.effect !== 'stars' || !enabled.value) return [];
  return Array.from({ length: STAR_COUNT }, () => {
    const size = 1 + Math.random() * 1.4;
    return {
      left: Math.random() * 100,
      top: Math.random() * 100,
      size,
      duration: 2 + Math.random() * 4,
      delay: -Math.random() * 5,
    };
  });
});

const showAurora = computed(() => props.effect === 'aurora' && enabled.value);
</script>

<template>
  <div v-if="enabled" class="lk-atmosphere" aria-hidden="true">
    <div
      v-for="(ember, index) in embers"
      :key="`ember-${index}`"
      class="lk-ember"
      :style="{
        left: `${ember.left}%`,
        animationDuration: `${ember.duration}s`,
        animationDelay: `${ember.delay}s`,
        '--lk-drift': `${ember.drift}px`,
      }"
    />
    <div
      v-for="(star, index) in stars"
      :key="`star-${index}`"
      class="lk-star"
      :style="{
        left: `${star.left}%`,
        top: `${star.top}%`,
        width: `${star.size}px`,
        height: `${star.size}px`,
        animationDuration: `${star.duration}s`,
        animationDelay: `${star.delay}s`,
      }"
    />
    <div v-if="showAurora" class="lk-aurora-blob lk-aurora-b1" />
    <div v-if="showAurora" class="lk-aurora-blob lk-aurora-b2" />
    <div v-if="showAurora" class="lk-aurora-blob lk-aurora-b3" />
  </div>
</template>

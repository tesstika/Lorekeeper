<script setup lang="ts" vapor>
import { onMounted, ref, useTemplateRef, watch } from 'vue';

const props = withDefaults(
  defineProps<{
    /** Changes whenever conversation content changes (drives auto-scroll). */
    watchKey?: number | string;
    /** Settings → "Auto-scroll on response stream". */
    autoScroll?: boolean;
  }>(),
  { watchKey: 0, autoScroll: true },
);

// Vapor template refs: `ref="scrollEl"` binds via useTemplateRef, NOT a plain
// ref() (M4 fix — the scroll manager was silently inert without this).
const scrollEl = useTemplateRef<HTMLElement>('scrollEl');
// Pinned-to-bottom by default; detached when the user scrolls up >120px (§6.5.1).
const pinned = ref(true);

const REATTACH_DISTANCE = 40;
const DETACH_DISTANCE = 120;

function distanceFromBottom(): number {
  const el = scrollEl.value;
  if (!el) return 0;
  return el.scrollHeight - el.scrollTop - el.clientHeight;
}

function scrollToBottom(smooth = false): void {
  const el = scrollEl.value;
  if (!el) return;
  try {
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  } catch {
    el.scrollTop = el.scrollHeight;
  }
}

function scheduleSmoothScroll(): void {
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => scrollToBottom(true));
  } else {
    scrollToBottom(true);
  }
}

function onScroll(): void {
  const distance = distanceFromBottom();
  if (distance > DETACH_DISTANCE) pinned.value = false;
  else if (distance <= REATTACH_DISTANCE) pinned.value = true;
}

onMounted(() => scrollToBottom(false));

watch(
  () => props.watchKey,
  () => {
    if (pinned.value && props.autoScroll) {
      // Await the DOM update that changed the content before scrolling.
      scheduleSmoothScroll();
    }
  },
  { flush: 'post' },
);
</script>

<template>
  <div
    ref="scrollEl"
    class="flex-1 overflow-y-auto px-5 pb-4"
    data-testid="message-list"
    @scroll.passive="onScroll"
  >
    <div class="flex flex-col gap-6">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts" vapor>
import { computed, ref, watch } from 'vue';
import { renderMarkdown } from '@/markdown';
import { CaretAnimator } from '@/streaming/caret';

const props = withDefaults(
  defineProps<{
    text: string;
    streaming?: boolean;
    caretBlinkMs?: number;
  }>(),
  { streaming: false, caretBlinkMs: 500 },
);

// -- Settled mode: full markdown pipeline -----------------------------------
const settledHtml = computed(() => (props.streaming ? '' : renderMarkdown(props.text)));

// -- Streaming mode (§6.7 Stage A) -------------------------------------------
// Bypasses markdown: deltas append as short fade-in runs; a rolling ~1s window
// merges them back into the base text node so the DOM never grows unbounded.
const streamHost = ref<HTMLElement | null>(null);
const caretEl = ref<HTMLElement | null>(null);
let baseNode: Text | null = null;
let lastRendered = '';
const runs: Array<HTMLSpanElement & { dataset: { at: string } }> = [];
const animator = new CaretAnimator(() => caretEl.value);

function ensureBaseNode(): boolean {
  const host = streamHost.value;
  const caret = caretEl.value;
  if (!host || !caret) return false;
  if (!baseNode) {
    baseNode = document.createTextNode(lastRendered);
    host.insertBefore(baseNode, caret);
  }
  return true;
}

function coalesceRuns(now: number): void {
  if (!baseNode) return;
  while (runs.length > 0 && now - Number(runs[0]?.dataset.at ?? 0) > 1000) {
    const run = runs.shift();
    if (!run) break;
    baseNode.data += run.textContent ?? '';
    run.remove();
  }
}

function applyDelta(delta: string): void {
  if (delta.length === 0) return;
  if (!ensureBaseNode()) {
    lastRendered += delta;
    return;
  }
  const now = performance.now();
  animator.apply(() => {
    const run = document.createElement('span') as HTMLSpanElement & { dataset: { at: string } };
    run.className = 'lk-fade-in';
    run.dataset.at = String(now);
    run.textContent = delta;
    caretEl.value?.before(run);
    runs.push(run);
  });
  lastRendered += delta;
  coalesceRuns(now);
}

watch(
  () => [props.text, streamHost.value] as const,
  ([next]) => {
    if (!props.streaming) return;
    if (next.length >= lastRendered.length) {
      applyDelta(next.slice(lastRendered.length));
    } else {
      // Shrank (e.g. cache replaced mid-stream): rebuild from scratch.
      if (baseNode) baseNode.data = next;
      for (const run of runs.splice(0)) run.remove();
      lastRendered = next;
    }
  },
  { flush: 'post' },
);

// Delegated handler for the code-block copy buttons rendered by the markdown
// pipeline (v-html content cannot bind listeners directly).
async function onSettledClick(event: Event): Promise<void> {
  const target = event.target as HTMLElement | null;
  if (!target?.classList.contains('lk-code-copy')) return;
  const code = target.closest('.lk-code')?.querySelector('pre code')?.textContent ?? '';
  const label = target.textContent ?? '';
  try {
    await navigator.clipboard.writeText(code);
    target.textContent = 'Copied';
    setTimeout(() => {
      target.textContent = label;
    }, 1200);
  } catch {
    target.textContent = 'Press Ctrl+C';
  }
}
</script>

<template>
  <div
    v-if="streaming"
    ref="streamHost"
    class="lk-prose lk-streaming"
    data-testid="streaming-body"
  >
    <span
      ref="caretEl"
      class="lk-caret"
      :style="{ '--lk-caret-blink': `${caretBlinkMs}ms` }"
      aria-hidden="true"
    />
  </div>
  <div v-else class="lk-prose" data-testid="settled-body" v-html="settledHtml" @click="onSettledClick" />
</template>

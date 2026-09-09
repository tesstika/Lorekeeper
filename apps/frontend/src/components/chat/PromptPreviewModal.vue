<script setup lang="ts" vapor>
import type { PromptPreviewResponse } from '@lorekeeper/shared';
import { computed, ref, watch } from 'vue';
import { api } from '@/api';
import { useUiStore } from '@/stores/ui';
import { describeApiError } from '@/utils/errors';
import { useOverlayA11y } from '@/utils/overlayA11y';

const props = defineProps<{ open: boolean; chatId: string }>();
const emit = defineEmits<{ close: [] }>();

const ui = useUiStore();

const preview = ref<PromptPreviewResponse | null>(null);
const loading = ref(false);
const errorText = ref<string | null>(null);

// (Vapor cannot bind template refs — the overlay is marked by data attribute.)
const { token } = useOverlayA11y(() => props.open, { onEscape: () => emit('close') });

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    preview.value = null;
    errorText.value = null;
    void load();
  },
);

async function load(): Promise<void> {
  loading.value = true;
  try {
    preview.value = await api.getPromptPreview(props.chatId);
  } catch (error) {
    errorText.value = describeApiError(error);
  } finally {
    loading.value = false;
  }
}

const utilization = computed(() => {
  const data = preview.value;
  if (!data || data.budget <= 0) return 0;
  return Math.min(100, Math.round((data.estimatedTokens / data.budget) * 100));
});

const utilizationTone = computed(() => {
  if (utilization.value >= 90) return 'bg-error';
  if (utilization.value >= 70) return 'bg-[#fbbf24]';
  return 'bg-primary-container';
});

function contentText(
  content: string | Array<{ type: string; text?: string; imageUrl?: { url: string } }>,
): string {
  if (typeof content === 'string') return content;
  return content
    .map((part) =>
      part.type === 'text' ? (part.text ?? '') : `[image part: ${part.imageUrl?.url ?? ''}]`,
    )
    .join('\n');
}

const fullPromptText = computed(() => {
  const data = preview.value;
  if (!data) return '';
  const sections = [`[SYSTEM]\n${data.system}`];
  for (const message of data.history) {
    sections.push(`[${message.role.toUpperCase()}]\n${contentText(message.content)}`);
  }
  if (data.trailing) sections.push(`[SYSTEM — post-history]\n${data.trailing}`);
  return sections.join('\n\n');
});

async function copyText(text: string, label: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      textarea.remove();
    }
    ui.notify(`${label} copied`, 'success');
  } catch {
    ui.notify('Could not copy to the clipboard', 'error');
  }
}
</script>

<template>
  <div
    v-if="props.open"
    :data-lk-overlay="token"
    class="fixed inset-0 z-50 flex items-end justify-center bg-surface-dim/70 backdrop-blur-sm sm:items-center"
    role="dialog"
    aria-modal="true"
    aria-label="Prompt preview — what the model sees"
    @click.self="emit('close')"
  >
    <div class="flex h-[92dvh] w-full max-w-[560px] flex-col overflow-hidden rounded-t-2xl border border-outline-variant/40 bg-surface-container sm:h-[85dvh] sm:rounded-2xl">
      <!-- Header -->
      <div class="flex flex-shrink-0 items-center justify-between border-b border-outline-variant/30 px-4 py-3">
        <div>
          <h2 class="text-[15px] font-semibold text-on-surface">What the model sees</h2>
          <p v-if="preview" class="mt-0.5 text-[11px] text-secondary">
            {{ preview.modelId ?? 'no model' }}
            <template v-if="preview.modelContextLength"> · {{ preview.modelContextLength.toLocaleString('en-US') }} ctx</template>
          </p>
        </div>
        <button
          type="button"
          aria-label="Close prompt preview"
          class="flex size-8 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
          @click="emit('close')"
        >
          <svg viewBox="0 0 24 24" class="size-5 fill-none stroke-current stroke-2"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
        </button>
      </div>

      <!-- Loading / error -->
      <div v-if="loading" class="flex flex-1 items-center justify-center gap-2 text-[13px] text-secondary">
        <svg viewBox="0 0 24 24" class="size-4 animate-spin fill-none stroke-current stroke-2"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
        Assembling the prompt…
      </div>
      <div v-else-if="errorText" class="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <p class="font-serif text-[14px] text-error">{{ errorText }}</p>
        <button
          type="button"
          class="rounded-full border border-outline-variant/40 px-4 py-1.5 text-[12px] text-on-surface transition-colors hover:border-primary/50"
          @click="load()"
        >Retry</button>
      </div>

      <template v-else-if="preview">
        <div class="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          <!-- Budget utilization -->
          <section aria-label="Context budget utilization">
            <div class="flex items-baseline justify-between text-[11px] text-secondary">
              <span>Context budget utilization</span>
              <span class="font-mono">
                {{ preview.estimatedTokens.toLocaleString('en-US') }} / {{ preview.budget.toLocaleString('en-US') }} tokens
                ({{ utilization }}%)
              </span>
            </div>
            <div class="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-container-highest">
              <div class="h-full rounded-full transition-all" :class="utilizationTone" :style="{ width: `${utilization}%` }" />
            </div>
            <p v-if="preview.droppedTurnsCount > 0" class="mt-1.5 text-[11px] text-[#fbbf24]">
              {{ preview.droppedTurnsCount }} older turn{{ preview.droppedTurnsCount === 1 ? '' : 's' }} trimmed to fit the budget.
            </p>
          </section>

          <!-- Warnings -->
          <section v-if="preview.warnings.length > 0" aria-label="Assembly warnings">
            <ul class="space-y-1">
              <li
                v-for="warning in preview.warnings"
                :key="warning"
                class="rounded-lg border border-[#fbbf24]/30 bg-[#fbbf24]/10 px-2.5 py-1.5 text-[11.5px] text-[#fbbf24]"
              >
                {{ warning }}
              </li>
            </ul>
          </section>

          <!-- System prompt -->
          <section aria-label="System prompt">
            <div class="flex items-center justify-between">
              <h3 class="text-[11px] font-semibold uppercase tracking-wider text-secondary">System prompt</h3>
              <button
                type="button"
                class="rounded px-2 py-0.5 text-[10.5px] uppercase tracking-wide text-secondary transition-colors hover:bg-surface-container-high hover:text-primary"
                @click="copyText(preview.system, 'System prompt')"
              >Copy</button>
            </div>
            <pre class="lk-preview-block mt-1.5 max-h-56">{{ preview.system }}</pre>
          </section>

          <!-- History -->
          <section aria-label="Assembled conversation history">
            <h3 class="text-[11px] font-semibold uppercase tracking-wider text-secondary">
              Conversation history ({{ preview.history.length }} message{{ preview.history.length === 1 ? '' : 's' }})
            </h3>
            <div class="mt-1.5 space-y-1.5">
              <div v-if="preview.history.length === 0" class="lk-preview-block text-[12px] italic text-outline">
                No history messages.
              </div>
              <div v-for="(message, index) in preview.history" :key="index" class="rounded-lg border border-outline-variant/25 bg-surface-container-low">
                <div class="flex items-center gap-2 border-b border-outline-variant/20 px-2.5 py-1">
                  <span
                    class="rounded px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide"
                    :class="message.role === 'user'
                      ? 'border border-amber-500/30 bg-amber-500/20 text-amber-200/90'
                      : 'border border-outline-variant/30 bg-secondary-container/50 text-secondary'"
                  >{{ message.role }}</span>
                </div>
                <pre class="max-h-40 overflow-y-auto px-2.5 py-2 font-serif text-[12.5px] leading-relaxed whitespace-pre-wrap text-on-surface-variant">{{ contentText(message.content) }}</pre>
              </div>
            </div>
          </section>

          <!-- Trailing system slot -->
          <section aria-label="Post-history system slot">
            <div class="flex items-center justify-between">
              <h3 class="text-[11px] font-semibold uppercase tracking-wider text-secondary">Post-history slot (PHI + jailbreak)</h3>
              <button
                v-if="preview.trailing"
                type="button"
                class="rounded px-2 py-0.5 text-[10.5px] uppercase tracking-wide text-secondary transition-colors hover:bg-surface-container-high hover:text-primary"
                @click="copyText(preview.trailing, 'Post-history slot')"
              >Copy</button>
            </div>
            <pre v-if="preview.trailing" class="lk-preview-block mt-1.5 max-h-40">{{ preview.trailing }}</pre>
            <p v-else class="mt-1.5 text-[12px] italic text-outline">Empty — no post-history instructions or character jailbreak.</p>
          </section>
        </div>

        <!-- Footer actions -->
        <div class="flex flex-shrink-0 gap-2 border-t border-outline-variant/30 px-4 py-3">
          <button
            type="button"
            class="flex-1 rounded-full border border-outline-variant/40 py-2 text-[12.5px] font-medium text-on-surface transition-colors hover:border-primary/50"
            @click="copyText(preview.system, 'System prompt')"
          >Copy system prompt</button>
          <button
            type="button"
            class="flex-1 rounded-full bg-primary-container py-2 text-[12.5px] font-semibold text-on-primary-container transition active:scale-95"
            @click="copyText(fullPromptText, 'Full prompt')"
          >Copy full prompt</button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.lk-preview-block {
  overflow-y: auto;
  border-radius: 0.5rem;
  border: 1px solid color-mix(in srgb, var(--color-outline-variant) 40%, transparent);
  background: var(--color-surface-container-lowest);
  padding: 0.6rem 0.75rem;
  font-family: var(--font-serif);
  font-size: 12.5px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--color-on-surface-variant);
}
</style>

<script setup lang="ts" vapor>
import { ref } from 'vue';
import IconX from '~icons/lucide/x';

const props = withDefaults(
  defineProps<{
    label: string;
    modelValue: string[];
    placeholder?: string | undefined;
    addLabel?: string | undefined;
    maxTags?: number | undefined;
  }>(),
  { placeholder: undefined, addLabel: undefined, maxTags: 16 },
);
const emit = defineEmits<{ 'update:modelValue': [value: string[]] }>();

const draft = ref('');
const inputEl = ref<HTMLInputElement | null>(null);

function onInput(event: Event): void {
  draft.value = (event.target as HTMLInputElement).value;
}

function addTag(): void {
  const value = draft.value.trim();
  if (!value) return;
  if (props.modelValue.length >= (props.maxTags ?? 16) || props.modelValue.includes(value)) {
    draft.value = '';
    return;
  }
  emit('update:modelValue', [...props.modelValue, value]);
  draft.value = '';
  inputEl.value?.focus();
}

function removeTag(tag: string): void {
  emit(
    'update:modelValue',
    props.modelValue.filter((item) => item !== tag),
  );
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter') {
    event.preventDefault();
    addTag();
  }
}
</script>

<template>
  <div class="space-y-2 pt-1">
    <div v-if="modelValue.length > 0" class="flex flex-wrap gap-2">
      <span
        v-for="tag in modelValue"
        :key="tag"
        class="flex items-center gap-1.5 rounded-md border border-outline-variant/50 bg-surface-container-highest px-2.5 py-1 font-mono text-xs text-on-surface"
      >
        <span>{{ tag }}</span>
        <button
          type="button"
          class="text-secondary transition-colors hover:text-error"
          :aria-label="`Remove ${label} ${tag}`"
          @click="removeTag(tag)"
        >
          <IconX class="size-3.5" />
        </button>
      </span>
    </div>
    <div class="flex items-center gap-2">
      <input
        ref="inputEl"
        type="text"
        class="w-full rounded-lg border border-outline-variant/30 bg-surface-container-low px-3 py-1.5 font-mono text-xs text-on-surface placeholder:text-outline focus:border-primary/60 focus:outline-none"
        :value="draft"
        :placeholder="placeholder ?? 'Type and press Enter…'"
        :aria-label="label"
        @input="onInput"
        @keydown="onKeydown"
      />
      <button
        type="button"
        class="rounded-md border border-outline-variant/40 bg-surface-container px-2.5 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-surface-container-high"
        :aria-label="`Add ${label}`"
        @click="addTag()"
      >
        {{ addLabel ?? '+ Add' }}
      </button>
    </div>
  </div>
</template>

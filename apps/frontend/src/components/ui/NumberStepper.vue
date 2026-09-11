<script setup lang="ts" vapor>
import IconMinus from '~icons/lucide/minus';
import IconPlus from '~icons/lucide/plus';

const props = withDefaults(
  defineProps<{
    label: string;
    min: number;
    max: number;
    step?: number;
    /** null renders as "Off" (value omitted from requests). */
    allowOff?: boolean;
    format?: ((value: number) => string) | undefined;
    modelValue: number | null;
  }>(),
  { step: 1, allowOff: false, format: undefined },
);
const emit = defineEmits<{ 'update:modelValue': [value: number | null] }>();

function displayValue(): string {
  if (props.modelValue === null) return 'Off';
  return props.format ? props.format(props.modelValue) : String(props.modelValue);
}

function decrease(): void {
  const current = props.modelValue ?? props.min;
  const next = Math.max(props.min, Number((current - props.step).toFixed(6)));
  emit(
    'update:modelValue',
    props.allowOff && next <= props.min && current <= props.min ? null : next,
  );
}

function increase(): void {
  const current = props.modelValue ?? props.min - props.step;
  emit('update:modelValue', Math.min(props.max, Number((current + props.step).toFixed(6))));
}
</script>

<template>
  <div class="flex items-center gap-2 rounded-lg border border-outline-variant/30 bg-surface-container-low p-1">
    <button
      type="button"
      class="flex h-7 w-7 items-center justify-center rounded text-on-surface-variant transition hover:bg-surface-container-highest hover:text-primary active:scale-95"
      :aria-label="`Decrease ${label}`"
      :disabled="modelValue === null"
      @click="decrease()"
    >
      <IconMinus class="size-4" />
    </button>
    <span class="px-2 font-mono text-xs font-semibold text-on-surface">{{ displayValue() }}</span>
    <button
      type="button"
      class="flex h-7 w-7 items-center justify-center rounded text-on-surface-variant transition hover:bg-surface-container-highest hover:text-primary active:scale-95"
      :aria-label="`Increase ${label}`"
      @click="increase()"
    >
      <IconPlus class="size-4" />
    </button>
  </div>
</template>

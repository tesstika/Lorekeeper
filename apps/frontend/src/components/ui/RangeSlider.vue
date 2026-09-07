<script setup lang="ts" vapor>
// Props + explicit emit: native `v-model` on range inputs desyncs under Vapor
// interop (initial value binding never lands), while template prop bindings do.
withDefaults(
  defineProps<{
    label: string;
    min: number;
    max: number;
    step?: number;
    scaleLabels?: [string, string, string] | undefined;
    modelValue: number;
  }>(),
  { step: 0.01, scaleLabels: undefined },
);
const emit = defineEmits<{ 'update:modelValue': [value: number] }>();

function onInput(event: Event): void {
  emit('update:modelValue', Number((event.target as HTMLInputElement).value));
}
</script>

<template>
  <div class="pt-1">
    <input
      type="range"
      class="lk-range w-full"
      :min="min"
      :max="max"
      :step="step"
      :value="modelValue"
      :aria-label="label"
      @input="onInput"
    />
    <div v-if="scaleLabels" class="flex justify-between pt-1 font-mono text-[10px] text-secondary">
      <span>{{ scaleLabels[0] }}</span>
      <span>{{ scaleLabels[1] }}</span>
      <span>{{ scaleLabels[2] }}</span>
    </div>
  </div>
</template>

<script setup lang="ts" vapor>
import IconPlus from '~icons/lucide/plus';
import IconTrash from '~icons/lucide/trash-2';

// Alternate greetings manager: add / edit-in-place / delete. Greeting text is
// bound with `:value` + explicit `@input` (vapor native-v-model caution, M1 §4.3).
const props = defineProps<{ greetings: string[] }>();

const emit = defineEmits<{ 'update:greetings': [value: string[]] }>();

function addGreeting(): void {
  emit('update:greetings', [...props.greetings, '']);
}

function updateGreeting(index: number, value: string): void {
  const next = [...props.greetings];
  next[index] = value;
  emit('update:greetings', next);
}

function removeGreeting(index: number): void {
  emit(
    'update:greetings',
    props.greetings.filter((_, i) => i !== index),
  );
}

function onInput(event: Event, index: number): void {
  updateGreeting(index, (event.target as HTMLTextAreaElement).value);
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <div v-if="greetings.length > 0" class="flex flex-col gap-2">
      <div
        v-for="(greeting, index) in greetings"
        :key="index"
        class="flex flex-col gap-1 rounded-lg border border-outline-variant/30 bg-surface-container-lowest p-2"
      >
        <div class="flex items-center justify-between px-1">
          <span class="text-[11px] font-medium text-primary">Greeting {{ index + 1 }}</span>
          <button
            type="button"
            class="text-secondary transition-colors hover:text-error"
            :aria-label="`Remove greeting ${index + 1}`"
            @click="removeGreeting(index)"
          >
            <IconTrash class="size-4" />
          </button>
        </div>
        <textarea
          rows="3"
          class="w-full resize-none rounded-md bg-transparent px-1 font-serif text-[14px] leading-relaxed text-on-surface placeholder:text-outline focus:outline-none"
          placeholder="An alternative opening line…"
          :value="greeting"
          :aria-label="`Alternate greeting ${index + 1}`"
          @input="onInput($event, index)"
        />
      </div>
    </div>
    <button
      type="button"
      class="flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-outline-variant/50 py-2 text-[12px] font-medium text-secondary transition-colors hover:border-primary/60 hover:text-primary"
      aria-label="Add alternate greeting"
      @click="addGreeting"
    >
      <IconPlus class="size-4" /> Add alternate greeting
    </button>
  </div>
</template>

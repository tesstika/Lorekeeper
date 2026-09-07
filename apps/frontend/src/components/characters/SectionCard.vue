<script setup lang="ts" vapor>
import { ref } from 'vue';
import IconChevron from '~icons/lucide/chevron-down';

// Accordion section card per the editor mockup. The icon arrives through the
// #icon slot (component-props + dynamic <component :is> are avoided inside
// vapor SFCs as a precaution).
const props = withDefaults(
  defineProps<{
    title: string;
    subtitle: string;
    defaultOpen?: boolean;
  }>(),
  { defaultOpen: false },
);

const open = ref(props.defaultOpen);

function toggle(): void {
  open.value = !open.value;
}
</script>

<template>
  <section class="overflow-hidden rounded-xl bg-surface-container shadow-sm transition-all">
    <button
      type="button"
      class="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-surface-container-high/50"
      :aria-expanded="open"
      @click="toggle"
    >
      <div class="flex items-center gap-2.5">
        <span class="flex size-7 items-center justify-center rounded-lg bg-surface-container-highest text-primary">
          <slot name="icon" />
        </span>
        <div>
          <h2 class="text-[15px] font-medium text-on-surface">{{ title }}</h2>
          <p class="text-[11px] text-on-surface-variant">{{ subtitle }}</p>
        </div>
      </div>
      <IconChevron
        class="text-xl transition-transform duration-200"
        :class="open ? 'rotate-180 text-primary' : 'text-on-surface-variant'"
      />
    </button>
    <div v-if="open" class="flex flex-col gap-4 px-4 pb-4 pt-1">
      <slot />
    </div>
  </section>
</template>

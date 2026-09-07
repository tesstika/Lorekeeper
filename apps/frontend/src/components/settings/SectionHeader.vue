<script setup lang="ts" vapor>
defineProps<{
  icon: object;
  title: string;
  caption?: string | undefined;
}>();
</script>

<template>
  <div class="flex items-center justify-between px-1">
    <h2 class="flex items-center gap-1.5 text-[16px] font-semibold leading-[22px] text-primary">
      <component :is="icon" class="size-[18px] text-primary" />
      {{ title }}
    </h2>
    <span v-if="caption" class="text-[11px] leading-[14px] tracking-wide text-secondary">
      {{ caption }}
    </span>
  </div>
</template>

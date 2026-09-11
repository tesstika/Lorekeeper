<script setup lang="ts" vapor>
import IconBook from '~icons/lucide/book-open-text';
import IconSliders from '~icons/lucide/sliders-horizontal';
import IconUsers from '~icons/lucide/users';
</script>

<template>
  <nav class="fixed inset-x-0 bottom-0 z-40 mx-auto max-w-97.5 border-t border-outline-variant/30 bg-surface/95 backdrop-blur-md">
    <div class="grid grid-cols-3">
      <RouterLink
        to="/chats"
        class="flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium text-outline transition-colors hover:text-secondary [&.router-link-active]:text-primary"
      >
        <IconBook class="size-5" />
        <span>Chats</span>
      </RouterLink>
      <RouterLink
        to="/characters"
        class="flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium text-outline transition-colors hover:text-secondary [&.router-link-active]:text-primary"
      >
        <IconUsers class="size-5" />
        <span>Characters</span>
      </RouterLink>
      <RouterLink
        to="/settings"
        class="flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium text-outline transition-colors hover:text-secondary [&.router-link-active]:text-primary"
      >
        <IconSliders class="size-5" />
        <span>Settings</span>
      </RouterLink>
    </div>
  </nav>
</template>

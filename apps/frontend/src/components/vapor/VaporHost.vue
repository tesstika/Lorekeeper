<script setup lang="ts">
// Classic VDOM host wrapping the pure-vapor probe (vapor↔vdom interop check).
import VaporProbe from './VaporProbe.vue';

defineProps<{ message: string }>();
</script>

<template>
  <div>
    <VaporProbe :message="message" />
  </div>
</template>

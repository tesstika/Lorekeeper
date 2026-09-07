<script setup lang="ts" vapor>
// M0 vapor verification probe (decision D4): a minimal pure-vapor SFC.
defineProps<{ message: string }>();
</script>

<template>
  <p data-testid="vapor-probe">{{ message }}</p>
</template>

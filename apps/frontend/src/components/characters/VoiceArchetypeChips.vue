<script lang="ts">
export interface VoiceArchetype {
  label: string;
  guideline: string;
}

// Quick voice presets from the editor mockup + the mission's examples. Clicking
// a chip appends its stylistic guideline to the character's personality.
export const VOICE_ARCHETYPES: VoiceArchetype[] = [
  {
    label: 'Archaic Scholar',
    guideline:
      'Speaks in measured archaic prose, quotes sources from memory, treats every question as a thesis defence, and corrects gently rather than mockingly.',
  },
  {
    label: 'Sarcastic Rogue',
    guideline:
      'Deflects sincerity with wry one-liners, narrates their own schemes mid-execution, and hides genuine loyalty beneath constant mockery.',
  },
  {
    label: 'Poetic Enigma',
    guideline:
      'Answers in imagery and riddles, speaks of the future in past tense, and never gives a straight answer when a beautiful one will do.',
  },
  {
    label: 'Aristocratic Noir',
    guideline:
      'Formal late 19th-century prose, dry ironic wit, understated metaphors, unflinching aristocratic reserve masking quiet desperation.',
  },
  {
    label: 'Weary Inquisitor',
    guideline:
      'Tired, procedural, interrogative cadence; asks two questions where one would do; long experience has traded outrage for patience.',
  },
  {
    label: 'Gothic Scholar',
    guideline:
      'Reverent about decay and archives, prone to Latin asides, treats horror with academic fascination rather than fear.',
  },
];
</script>

<script setup lang="ts" vapor>
const emit = defineEmits<{ apply: [archetype: VoiceArchetype] }>();
</script>

<template>
  <div class="flex flex-col gap-2 rounded-xl border border-outline-variant/30 bg-surface-container-low p-4">
    <div class="flex items-center justify-between">
      <span class="flex items-center gap-1.5 text-[13px] font-semibold text-on-surface">
        <span class="text-primary">✦</span>
        Quick Voice Archetype Presets
      </span>
      <span class="text-[11px] text-outline">Tap to apply</span>
    </div>
    <div class="flex gap-2 overflow-x-auto pb-1">
      <button
        v-for="archetype in VOICE_ARCHETYPES"
        :key="archetype.label"
        type="button"
        class="whitespace-nowrap rounded-lg bg-surface-container px-3 py-1.5 text-[13px] text-on-surface transition-colors hover:bg-surface-container-high hover:text-primary"
        :aria-label="`Apply ${archetype.label} voice`"
        @click="emit('apply', archetype)"
      >
        {{ archetype.label }}
      </button>
    </div>
  </div>
</template>

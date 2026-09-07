<script setup lang="ts" vapor>
import { computed } from 'vue';
import NumberStepper from '@/components/ui/NumberStepper.vue';
import RangeSlider from '@/components/ui/RangeSlider.vue';
import TagInput from '@/components/ui/TagInput.vue';
import { useSettingsStore } from '@/stores/settings';
import { describeApiError } from '@/utils/errors';
import IconSliders from '~icons/lucide/sliders-horizontal';
import SectionHeader from './SectionHeader.vue';

const store = useSettingsStore();

const target = computed(() => store.workingPreset);
const hasTarget = computed(() => store.activePreset !== null);

function temperatureLabel(value: number): string {
  if (value <= 0.3) return 'Precise & Deterministic';
  if (value <= 0.7) return 'Balanced';
  if (value <= 1.2) return 'Creative & Expressive';
  return 'Vivid & Chaotic';
}

function topPLabel(value: number): string {
  if (value <= 0.5) return 'Narrow & Safe';
  if (value <= 0.9) return 'Nucleus Sampling';
  return 'Unrestricted';
}

function formatTokens(value: number): string {
  return value.toLocaleString('en-US');
}
</script>

<template>
  <section class="space-y-2">
    <SectionHeader
      :icon="IconSliders"
      title="Sampling & Context Tuning"
      :caption="hasTarget ? store.activePreset?.name : 'Unsaved draft'"
    />
    <div class="divide-y divide-outline-variant/25 overflow-hidden rounded-xl border border-outline-variant/40 bg-surface-container shadow-sm">
      <div
        v-if="!hasTarget"
        class="flex items-center gap-2 bg-surface-container-lowest px-3.5 py-2.5 text-[11px] text-secondary"
      >
        <IconSliders class="size-3.5 shrink-0 text-primary" />
        No preset selected — tune freely, then “Save as New” below to keep it.
      </div>

      <!-- Temperature -->
      <div class="space-y-2 p-3.5">
        <div class="flex items-center justify-between">
          <div>
            <div class="flex items-center gap-2">
              <span class="text-[16px] font-semibold leading-[22px] text-on-surface">Temperature</span>
              <span class="text-xs italic text-primary-container">{{ temperatureLabel(target.temperature) }}</span>
            </div>
            <p class="mt-0.5 text-[11px] leading-[14px] text-secondary">
              Controls narrative randomness and metaphorical flair.
            </p>
          </div>
          <span class="rounded-full border border-outline-variant/40 bg-surface-container-highest px-2.5 py-0.5 font-mono text-xs font-semibold text-primary">
            {{ target.temperature.toFixed(2) }}
          </span>
        </div>
        <RangeSlider
          v-model="target.temperature"
          label="Temperature"
          :min="0"
          :max="2"
          :step="0.01"
          :scale-labels="['0.0 (Precise)', '1.0 (Balanced)', '2.0 (Chaotic)']"
        />
      </div>

      <!-- Top P -->
      <div class="space-y-2 p-3.5">
        <div class="flex items-center justify-between">
          <div>
            <div class="flex items-center gap-2">
              <span class="text-[16px] font-semibold leading-[22px] text-on-surface">Top P</span>
              <span class="text-xs italic text-secondary">{{ topPLabel(target.topP) }}</span>
            </div>
            <p class="mt-0.5 text-[11px] leading-[14px] text-secondary">
              Limits selection to tokens comprising the top probability mass.
            </p>
          </div>
          <span class="rounded-full border border-outline-variant/40 bg-surface-container-highest px-2.5 py-0.5 font-mono text-xs font-semibold text-primary">
            {{ target.topP.toFixed(2) }}
          </span>
        </div>
        <RangeSlider
          v-model="target.topP"
          label="Top P"
          :min="0"
          :max="1"
          :step="0.01"
          :scale-labels="['0.00 (Narrow)', '0.50', '1.00 (Unrestricted)']"
        />
      </div>

      <!-- Top K -->
      <div class="flex items-center justify-between p-3.5">
        <div>
          <span class="text-[16px] font-semibold leading-[22px] text-on-surface">Top K</span>
          <p class="mt-0.5 text-[11px] leading-[14px] text-secondary">
            Candidate cap per step — omitted from requests when Off.
          </p>
        </div>
        <NumberStepper v-model="target.topK" label="top K" :min="1" :max="200" :step="1" :allow-off="true" />
      </div>

      <!-- Max Response Tokens -->
      <div class="flex items-center justify-between p-3.5">
        <div>
          <span class="text-[16px] font-semibold leading-[22px] text-on-surface">Max Response Tokens</span>
          <p class="mt-0.5 text-[11px] leading-[14px] text-secondary">
            Maximum length reserved for the model's reply.
          </p>
        </div>
        <NumberStepper
          v-model="target.maxTokens"
          label="max response tokens"
          :min="64"
          :max="100000"
          :step="256"
          :format="formatTokens"
        />
      </div>

      <!-- Frequency Penalty -->
      <div class="flex items-center justify-between p-3.5">
        <div>
          <span class="text-[16px] font-semibold leading-[22px] text-on-surface">Frequency Penalty</span>
          <p class="mt-0.5 text-[11px] leading-[14px] text-secondary">
            Reduces direct verbatim phrase repetitions.
          </p>
        </div>
        <NumberStepper
          v-model="target.frequencyPenalty"
          label="frequency penalty"
          :min="-2"
          :max="2"
          :step="0.05"
          :format="(value: number) => value.toFixed(2)"
        />
      </div>

      <!-- Presence Penalty -->
      <div class="flex items-center justify-between p-3.5">
        <div>
          <span class="text-[16px] font-semibold leading-[22px] text-on-surface">Presence Penalty</span>
          <p class="mt-0.5 text-[11px] leading-[14px] text-secondary">
            Encourages fresh plot elements and locations.
          </p>
        </div>
        <NumberStepper
          v-model="target.presencePenalty"
          label="presence penalty"
          :min="-2"
          :max="2"
          :step="0.05"
          :format="(value: number) => value.toFixed(2)"
        />
      </div>

      <!-- Stop Sequences -->
      <div class="p-3.5">
        <p class="text-[16px] font-semibold leading-[22px] text-on-surface">Stop Sequences</p>
        <p class="mt-0.5 text-[11px] leading-[14px] text-secondary">
          Strings that immediately halt generation turns.
        </p>
        <TagInput
          v-model="target.stopSequences"
          label="stop sequence"
          placeholder="Type a stop string and press Enter…"
          add-label="+ Add Tag"
          :max-tags="16"
        />
      </div>
    </div>
  </section>
</template>

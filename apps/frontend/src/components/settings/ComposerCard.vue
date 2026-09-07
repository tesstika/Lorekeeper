<script setup lang="ts" vapor>
import { computed } from 'vue';
import NumberStepper from '@/components/ui/NumberStepper.vue';
import RangeSlider from '@/components/ui/RangeSlider.vue';
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue';
import { useSettingsStore } from '@/stores/settings';
import IconEditNote from '~icons/lucide/pen-tool';
import SectionHeader from './SectionHeader.vue';

const store = useSettingsStore();

const composer = computed(() => store.composer);

function update(patch: Parameters<typeof store.updateComposer>[0]): void {
  store.updateComposer(patch).catch(() => {
    // Re-sync from the server so the UI reflects the stored state after a failure.
    void store.load(true);
  });
}
</script>

<template>
  <section class="space-y-2">
    <SectionHeader :icon="IconEditNote" title="Composer Behavior" caption="Typing & Stream" />
    <div class="divide-y divide-outline-variant/25 overflow-hidden rounded-xl border border-outline-variant/40 bg-surface-container shadow-sm">
      <!-- Enter sends message -->
      <div class="flex items-center justify-between p-3.5">
        <div class="pr-4">
          <span class="text-[16px] font-semibold leading-[22px] text-on-surface">Enter sends message</span>
          <p class="mt-0.5 text-[11px] leading-[14px] text-secondary">
            Shift + Enter creates a new paragraph line.
          </p>
        </div>
        <ToggleSwitch
          v-model="composer.enterToSend"
          label="Enter sends message"
          @update:model-value="update({ enterToSend: composer.enterToSend })"
        />
      </div>

      <!-- Auto-scroll -->
      <div class="flex items-center justify-between p-3.5">
        <div class="pr-4">
          <span class="text-[16px] font-semibold leading-[22px] text-on-surface">Auto-scroll on response stream</span>
          <p class="mt-0.5 text-[11px] leading-[14px] text-secondary">
            Keeps the view anchored to the prose generation front.
          </p>
        </div>
        <ToggleSwitch
          v-model="composer.autoScroll"
          label="Auto-scroll on response stream"
          @update:model-value="update({ autoScroll: composer.autoScroll })"
        />
      </div>

      <!-- Edit default regenerate (D8) -->
      <div class="flex items-center justify-between p-3.5">
        <div class="pr-4">
          <span class="text-[16px] font-semibold leading-[22px] text-on-surface">Edit defaults to regenerate</span>
          <p class="mt-0.5 text-[11px] leading-[14px] text-secondary">
            The edit dialog defaults to “Save &amp; regenerate after” instead of Save.
          </p>
        </div>
        <ToggleSwitch
          v-model="composer.editDefaultRegenerate"
          label="Edit defaults to regenerate after saving"
          @update:model-value="update({ editDefaultRegenerate: composer.editDefaultRegenerate })"
        />
      </div>

      <!-- Caret blink interval -->
      <div class="space-y-2 p-3.5">
        <div class="flex items-center justify-between">
          <div>
            <span class="text-[16px] font-semibold leading-[22px] text-on-surface">Caret blink interval</span>
            <p class="mt-0.5 text-[11px] leading-[14px] text-secondary">
              Streaming caret blink period while text arrives.
            </p>
          </div>
          <span class="rounded-full border border-outline-variant/40 bg-surface-container-highest px-2.5 py-0.5 font-mono text-xs font-semibold text-primary">
            {{ composer.caretBlinkMs }}ms
          </span>
        </div>
        <RangeSlider
          v-model="composer.caretBlinkMs"
          label="Caret blink interval"
          :min="100"
          :max="2000"
          :step="50"
          :scale-labels="['100ms', '500ms', '2000ms']"
          @update:model-value="update({ caretBlinkMs: composer.caretBlinkMs })"
        />
      </div>

      <!-- Delivered blink interval -->
      <div class="space-y-2 p-3.5">
        <div class="flex items-center justify-between">
          <div>
            <span class="text-[16px] font-semibold leading-[22px] text-on-surface">Delivered blink interval</span>
            <p class="mt-0.5 text-[11px] leading-[14px] text-secondary">
              Post-stream “delivered” dot blink period.
            </p>
          </div>
          <span class="rounded-full border border-outline-variant/40 bg-surface-container-highest px-2.5 py-0.5 font-mono text-xs font-semibold text-primary">
            {{ composer.deliveredBlinkMs }}ms
          </span>
        </div>
        <RangeSlider
          v-model="composer.deliveredBlinkMs"
          label="Delivered blink interval"
          :min="50"
          :max="2000"
          :step="50"
          :scale-labels="['50ms', '250ms', '2000ms']"
          @update:model-value="update({ deliveredBlinkMs: composer.deliveredBlinkMs })"
        />
      </div>

      <!-- Delivered blink count -->
      <div class="flex items-center justify-between p-3.5">
        <div>
          <span class="text-[16px] font-semibold leading-[22px] text-on-surface">Delivered blink count</span>
          <p class="mt-0.5 text-[11px] leading-[14px] text-secondary">
            How many times the delivered dot blinks before settling.
          </p>
        </div>
        <NumberStepper
          v-model="composer.deliveredBlinks"
          label="delivered blink count"
          :min="1"
          :max="30"
          :step="1"
          @update:model-value="update({ deliveredBlinks: composer.deliveredBlinks })"
        />
      </div>
    </div>
  </section>
</template>

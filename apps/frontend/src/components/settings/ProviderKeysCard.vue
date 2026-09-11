<script setup lang="ts" vapor>
import type { ProviderId, ProviderInfo } from '@lorekeeper/shared';
import { computed, reactive } from 'vue';
import { useSettingsStore } from '@/stores/settings';
import { useUiStore } from '@/stores/ui';
import { describeApiError } from '@/utils/errors';
import IconClipboard from '~icons/lucide/clipboard-paste';
import IconEye from '~icons/lucide/eye';
import IconEyeOff from '~icons/lucide/eye-off';
import IconLock from '~icons/lucide/lock';
import IconTrash from '~icons/lucide/trash-2';
import IconZap from '~icons/lucide/zap';
import SectionHeader from './SectionHeader.vue';

const store = useSettingsStore();
const ui = useUiStore();

const props = defineProps<{ providers: ProviderInfo[] }>();

const draftKeys = reactive<Record<ProviderId, string>>({ openrouter: '', unorouter: '' });
const revealed = reactive<Record<ProviderId, boolean>>({ openrouter: false, unorouter: false });
const busy = reactive<Record<ProviderId, boolean>>({ openrouter: false, unorouter: false });
const testing = reactive<Record<ProviderId, boolean>>({ openrouter: false, unorouter: false });
const confirmingClear = reactive<Record<ProviderId, boolean>>({
  openrouter: false,
  unorouter: false,
});

const activeCount = computed(() => props.providers.filter((p) => p.hasKey).length);

const badges: Record<ProviderId, string> = { openrouter: 'Primary', unorouter: 'Failover' };

function statusText(provider: ProviderInfo): string {
  if (!provider.hasKey) return 'Not configured';
  if (provider.status === 'error') return 'Error — check connection';
  if (provider.latencyMs === null) return 'Key saved — not verified';
  return `Connected (Latency ${provider.latencyMs}ms)`;
}

function statusColor(provider: ProviderInfo): string {
  if (!provider.hasKey) return 'text-secondary';
  if (provider.status === 'error') return 'text-error';
  return 'text-emerald-300';
}

function dotColor(provider: ProviderInfo): string {
  if (!provider.hasKey) return 'bg-surface-container-highest';
  if (provider.status === 'error') return 'bg-error';
  return 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]';
}

async function pasteKey(id: ProviderId): Promise<void> {
  try {
    const text = await navigator.clipboard.readText();
    if (text) draftKeys[id] = text.trim();
  } catch {
    ui.notify('Clipboard is unavailable — paste with Ctrl+V instead', 'error');
  }
}

function onDraftInput(id: ProviderId, event: Event): void {
  draftKeys[id] = (event.target as HTMLInputElement).value;
}

async function saveKey(id: ProviderId): Promise<void> {
  const key = draftKeys[id]?.trim() ?? '';
  if (key.length < 8) {
    ui.notify('API key must be at least 8 characters', 'error');
    return;
  }
  busy[id] = true;
  try {
    await store.saveProviderKey(id, key);
    draftKeys[id] = '';
    revealed[id] = false;
  } catch (error) {
    ui.notify(describeApiError(error), 'error');
  } finally {
    busy[id] = false;
  }
}

async function clearKey(id: ProviderId): Promise<void> {
  if (!confirmingClear[id]) {
    confirmingClear[id] = true;
    setTimeout(() => {
      confirmingClear[id] = false;
    }, 3000);
    return;
  }
  confirmingClear[id] = false;
  busy[id] = true;
  try {
    await store.clearProviderKey(id);
  } catch (error) {
    ui.notify(describeApiError(error), 'error');
  } finally {
    busy[id] = false;
  }
}

async function testConnection(id: ProviderId): Promise<void> {
  testing[id] = true;
  try {
    const result = await store.testProvider(id);
    if (result.status === 'connected' && result.latencyMs !== null) {
      ui.notify(`Connected in ${result.latencyMs}ms`, 'success');
    } else {
      ui.notify(result.message ?? 'Connection test failed', 'error');
    }
  } catch (error) {
    ui.notify(describeApiError(error), 'error');
  } finally {
    testing[id] = false;
  }
}
</script>

<template>
  <section class="space-y-2">
    <SectionHeader
      :icon="IconZap"
      title="API Providers & Keys"
      :caption="`${activeCount} Endpoint${activeCount === 1 ? '' : 's'} Active`"
    />
    <div class="divide-y divide-outline-variant/25 overflow-hidden rounded-xl border border-outline-variant/40 bg-surface-container shadow-sm">
      <div v-for="provider in providers" :key="provider.id" class="space-y-2 p-3.5">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="text-[16px] font-semibold leading-5.5 text-on-surface">{{ provider.label }}</span>
            <span class="rounded-full border border-outline-variant/30 bg-surface-container-highest px-2 py-0.5 text-[10px] font-medium text-secondary">
              {{ badges[provider.id] }}
            </span>
          </div>
          <div class="flex items-center gap-1.5" :class="statusColor(provider)">
            <span class="h-2 w-2 rounded-full" :class="dotColor(provider)"></span>
            <span class="text-[11px] leading-3.5">{{ statusText(provider) }}</span>
          </div>
        </div>
        <div class="relative flex items-center">
          <input
            :value="draftKeys[provider.id]"
            :type="revealed[provider.id] ? 'text' : 'password'"
            class="w-full rounded-lg border border-outline-variant/30 bg-surface-container-low px-3 py-2 pr-30 font-mono text-xs text-on-surface placeholder:text-outline focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            :placeholder="provider.hasKey ? provider.keyHint ?? '' : `Enter ${provider.label} API key…`"
            :aria-label="`${provider.label} API key`"
            autocomplete="off"
            spellcheck="false"
            @input="onDraftInput(provider.id, $event)"
          />
          <div class="absolute right-2 flex items-center gap-1">
            <button
              type="button"
              class="rounded p-1 text-on-surface-variant transition-colors hover:text-primary"
              :title="revealed[provider.id] ? 'Hide key' : 'Reveal input'"
              :aria-label="revealed[provider.id] ? 'Hide key input' : 'Reveal key input'"
              @click="revealed[provider.id] = !revealed[provider.id]"
            >
              <IconEyeOff v-if="revealed[provider.id]" class="size-4.5" />
              <IconEye v-else class="size-4.5" />
            </button>
            <button
              type="button"
              class="rounded p-1 text-on-surface-variant transition-colors hover:text-primary"
              title="Paste key"
              :aria-label="`Paste ${provider.label} API key`"
              @click="pasteKey(provider.id)"
            >
              <IconClipboard class="size-4.5" />
            </button>
            <button
              type="button"
              class="rounded-md border border-outline-variant/40 bg-surface-container px-2 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-surface-container-high disabled:opacity-50"
              :disabled="busy[provider.id] || (draftKeys[provider.id]?.trim().length ?? 0) < 8"
              :aria-label="`Save ${provider.label} API key`"
              @click="saveKey(provider.id)"
            >
              Save
            </button>
            <button
              v-if="provider.hasKey"
              type="button"
              class="rounded p-1 text-on-surface-variant transition-colors hover:text-error"
              :class="{ 'text-error': confirmingClear[provider.id] }"
              :title="confirmingClear[provider.id] ? 'Tap again to confirm' : 'Clear stored key'"
              :aria-label="confirmingClear[provider.id] ? `Confirm clearing ${provider.label} key` : `Clear ${provider.label} key`"
              @click="clearKey(provider.id)"
            >
              <IconTrash class="size-4.5" />
            </button>
          </div>
        </div>
        <div class="flex items-center justify-between">
          <span v-if="provider.hasKey" class="font-mono text-[11px] text-secondary">{{ provider.keyHint }}</span>
          <span v-else class="text-[11px] text-outline">No key stored — get one from the provider dashboard.</span>
          <button
            type="button"
            class="flex items-center gap-1.5 rounded-full border border-outline-variant/40 bg-surface-container px-3 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-surface-container-high disabled:opacity-50"
            :disabled="testing[provider.id] || !provider.hasKey"
            :aria-label="`Test ${provider.label} connection`"
            @click="testConnection(provider.id)"
          >
            <IconZap class="size-3" />
            {{ testing[provider.id] ? 'Testing…' : 'Test Connection' }}
          </button>
        </div>
      </div>
    </div>
    <div class="flex items-center gap-1.5 px-2 text-secondary">
      <IconLock class="size-3.5" />
      <p class="text-[11px] leading-3.5 tracking-wide">Keys are stored encrypted locally on your device.</p>
    </div>
  </section>
</template>

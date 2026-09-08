import { readFileSync } from 'node:fs';
import path from 'node:path';
import type {
  Character,
  ChatMessageInput,
  ChatRequest,
  GlobalDefaults,
  ModelInfo,
  Persona,
  Preset,
  PromptTemplate,
} from '@lorekeeper/shared';
import type { attachments } from '../db/schema';
import {
  computeHistoryBudgetTokens,
  estimateHistoryTokens,
  type PromptHistoryMessage,
  renderSystemPrompt,
  renderTrailingSystemSlot,
  selectHistoryForPrompt,
} from './systemPrompt';

type AttachmentRow = typeof attachments.$inferSelect;

/**
 * Zero-defaults fallback for sampling (M1 audit D-S1): when neither the chat
 * nor `globalDefaults` selects a preset, generation uses the preset schema's
 * default sampling values instead of failing.
 */
export const FALLBACK_PRESET: Preset = {
  id: '',
  name: 'Fallback Defaults',
  description: 'Built-in sampling defaults used when no preset is configured.',
  temperature: 0.85,
  topP: 0.92,
  topK: null,
  maxTokens: 4096,
  frequencyPenalty: 0,
  presencePenalty: 0,
  repetitionPenalty: null,
  stopSequences: [],
  isDefault: false,
  createdAt: '',
  updatedAt: '',
};

export interface AssembledPrompt {
  request: ChatRequest;
  systemText: string;
  trailingSystemText: string | null;
  historyBudgetTokens: number;
  usedTokens: number;
  droppedTurnCount: number;
  warnings: string[];
  exampleDialogueCondensed: boolean;
  /** The assembled history (system/trailing slots excluded) for debug views. */
  historyMessages: ChatMessageInput[];
}

export interface BuildPromptOptions {
  character: Character;
  persona: Persona | null;
  promptTemplate: PromptTemplate;
  globalDefaults: Pick<GlobalDefaults, 'contextBudgetTokens'>;
  preset: Preset | null;
  modelInfo: ModelInfo | null;
  /** Active-variant history (inclusion-filtered, target group excluded), seq order. */
  history: PromptHistoryMessage[];
  /** Attachments of the newest user message (may be empty). */
  finalUserAttachments: AttachmentRow[];
  dataDir: string;
}

const SUPPORTED_IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

function readImageDataUrl(dataDir: string, attachment: AttachmentRow): string | null {
  try {
    const bytes = readFileSync(path.join(dataDir, attachment.filePath));
    if (!SUPPORTED_IMAGE_MIME.has(attachment.mimeType)) return null;
    return `data:${attachment.mimeType};base64,${bytes.toString('base64')}`;
  } catch {
    return null;
  }
}

/**
 * Builds the final wire request (plan §4.2):
 *   [system template] + [trimmed active history] + [trailing system slot]
 * Images ride on the final user turn as base64 data URLs — text part first,
 * then image parts (OpenRouter-recommended order).
 */
export function buildAssembledPrompt(options: BuildPromptOptions): AssembledPrompt {
  const warnings: string[] = [];
  const preset = options.preset ?? FALLBACK_PRESET;

  // Pre-budget for the 25% example-dialogue share uses the raw budget.
  const contextBudgetTokens = options.globalDefaults.contextBudgetTokens;
  const probe = renderSystemPrompt({
    template: options.promptTemplate.systemTemplate,
    character: options.character,
    persona: options.persona,
    budgetTokens: contextBudgetTokens,
  });
  const trailingSystemText = renderTrailingSystemSlot(
    options.promptTemplate,
    options.character.jailbreak,
  );

  const budgetInput = {
    modelContextLength: options.modelInfo?.contextLength ?? null,
    maxTokens: preset.maxTokens,
    contextBudgetTokens,
    systemText: probe.systemText,
    trailingSystemText,
  };
  if (options.modelInfo?.contextLength == null) {
    warnings.push(
      'Model context length is unknown for this provider; the global context budget alone bounds the prompt.',
    );
  }
  const historyBudgetTokens = computeHistoryBudgetTokens(budgetInput);
  const selection = selectHistoryForPrompt(options.history, historyBudgetTokens);

  const historyMessages: ChatMessageInput[] = selection.included.map((message) => ({
    role: message.role,
    content: message.text,
  }));

  // Multimodal payload: images attach to the FINAL user turn (text part
  // first, then image parts).
  const finalUser = [...selection.included].reverse().find((message) => message.role === 'user');
  if (options.finalUserAttachments.length > 0) {
    if (!finalUser) {
      warnings.push('No user turn available to attach images to; attachments were skipped.');
    } else {
      const modalities = options.modelInfo?.inputModalities ?? [];
      if (!modalities.includes('image')) {
        warnings.push(
          'This model does not advertise image input (or metadata is unavailable); images are sent anyway and may be rejected (A1).',
        );
      }
      const images: string[] = [];
      for (const attachment of options.finalUserAttachments) {
        const dataUrl = readImageDataUrl(options.dataDir, attachment);
        if (dataUrl) images.push(dataUrl);
        else
          warnings.push(
            `Attachment ${attachment.originalName} could not be read from disk and was skipped.`,
          );
      }
      if (images.length > 0) {
        const target = historyMessages.findLast((message) => message.role === 'user');
        if (target) {
          const text = typeof target.content === 'string' ? target.content : '';
          target.content = [
            { type: 'text', text },
            ...images.map((url) => ({ type: 'image_url' as const, imageUrl: { url } })),
          ];
        }
      }
    }
  }

  const messages: ChatMessageInput[] = [
    { role: 'system', content: probe.systemText },
    ...historyMessages,
  ];
  if (trailingSystemText) {
    messages.push({ role: 'system', content: trailingSystemText });
  }

  const request: ChatRequest = {
    model: '', // filled by the caller from the resolved model id
    messages,
    temperature: preset.temperature,
    topP: preset.topP,
    ...(preset.topK != null ? { topK: preset.topK } : {}),
    maxTokens: preset.maxTokens,
    frequencyPenalty: preset.frequencyPenalty,
    presencePenalty: preset.presencePenalty,
    ...(preset.repetitionPenalty != null ? { repetitionPenalty: preset.repetitionPenalty } : {}),
    stopSequences: [...preset.stopSequences],
  };

  return {
    request,
    systemText: probe.systemText,
    trailingSystemText,
    historyBudgetTokens,
    usedTokens: estimateHistoryTokens(selection.included),
    droppedTurnCount: selection.droppedCount,
    warnings,
    exampleDialogueCondensed: probe.exampleDialogueCondensed,
    historyMessages,
  };
}

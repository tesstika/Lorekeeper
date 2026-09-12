import type { LorekeeperDb } from '../db/client';
import { type AssembledPrompt, buildAssembledPrompt } from '../prompt/assemble';
import type { PromptHistoryMessage } from '../prompt/systemPrompt';
import { getCharacter } from '../services/charactersRepo';
import type { ChatRow } from '../services/chatsRepo';
import { createImageCaptioner } from '../services/imageCaptioner';
import { type AttachmentRow, getAttachmentRows, listMessageRows } from '../services/messagesRepo';
import { getPersona } from '../services/personasRepo';
import { getPreset } from '../services/presetsRepo';
import { getImageCaptioning, getPromptTemplate } from '../services/settingsRepo';
import {
  type ResolvedGenerationConfig,
  resolveContextBudgetTokens,
  resolveGenerationConfig,
  SessionConfigError,
} from './config';

// ---------------------------------------------------------------------------
// Shared prompt-input loading (M4): one code path for the generation session
// AND the prompt-preview debug endpoint, so the preview always shows exactly
// what a generation would assemble.
// ---------------------------------------------------------------------------

export interface PromptInputs {
  config: ResolvedGenerationConfig;
  assembled: AssembledPrompt;
}

/** Active-variant history up to `cutoffSeq` (regenerate target exclusion). */
function historyUpTo(db: LorekeeperDb, chatId: string, cutoffSeq: number): PromptHistoryMessage[] {
  return listMessageRows(db, chatId)
    .filter((row) => row.isActive && row.text.trim().length > 0 && row.seq < cutoffSeq)
    .map((row) => ({ id: row.id, seq: row.seq, role: row.role, text: row.text }));
}

function finalUserAttachmentsOf(
  db: LorekeeperDb,
  history: PromptHistoryMessage[],
): AttachmentRow[] {
  const lastUser = [...history].reverse().find((message) => message.role === 'user');
  return lastUser ? getAttachmentRows(db, [lastUser.id]) : [];
}

/**
 * Vision-helper pre-pass (feature spec §C): captions uncaptioned attachments
 * of the final user turn through the local Ollama vision model. MUST run
 * before the generation session's synchronous critical path (D-T3) — callers
 * invoke it in their async pre-flight zone. Failures are non-fatal: the
 * returned warnings flow into the prompt warnings (visible in the preview)
 * and assemble omits the affected images for non-vision models.
 */
export async function captionAttachmentsForChat(
  db: LorekeeperDb,
  dataDir: string,
  chat: ChatRow,
  options: { cutoffSeq?: number } = {},
): Promise<string[]> {
  const settings = getImageCaptioning(db);
  if (!settings.enabled) return [];
  const cutoffSeq = options.cutoffSeq ?? Number.MAX_SAFE_INTEGER;
  const attachments = finalUserAttachmentsOf(db, historyUpTo(db, chat.id, cutoffSeq));
  const pending = attachments.filter((row) => row.caption === null);
  if (pending.length === 0) return [];
  const captioner = createImageCaptioner(db, dataDir);
  const warnings: string[] = [];
  for (const row of pending) {
    const outcome = await captioner.captionAttachment(row);
    if (outcome.warning) warnings.push(`"${row.originalName}": ${outcome.warning}`);
  }
  return warnings;
}

/**
 * Resolves effective config and assembles the full prompt for `chat`.
 * `cutoffSeq` excludes history at/after it (regenerate target's own group);
 * omit it for a fresh-generate view (prompt preview). Call
 * `captionAttachmentsForChat` first when the vision helper is enabled —
 * captions cached by it flow straight into the assembled payload.
 */
export function loadPromptInputs(
  db: LorekeeperDb,
  dataDir: string,
  chat: ChatRow,
  options: { cutoffSeq?: number; captionWarnings?: string[] } = {},
): PromptInputs {
  const config = resolveGenerationConfig(db, chat);

  const character = getCharacter(db, chat.characterId);
  if (!character) {
    throw new SessionConfigError('not_found', 'The chat character no longer exists');
  }
  const persona = config.personaId ? getPersona(db, config.personaId) : null;
  const preset = config.presetId ? getPreset(db, config.presetId) : null;
  const promptTemplate = getPromptTemplate(db);
  const imageCaptioningEnabled = getImageCaptioning(db).enabled;

  // Active variants with non-empty text only (history inclusion rule, §3.1).
  const cutoffSeq = options.cutoffSeq ?? Number.MAX_SAFE_INTEGER;
  const history = historyUpTo(db, chat.id, cutoffSeq);

  // Final user turn's attachments ride into the multimodal payload.
  const finalUserAttachments = finalUserAttachmentsOf(db, history);

  const assembled = buildAssembledPrompt({
    character,
    persona,
    promptTemplate,
    globalDefaults: { contextBudgetTokens: resolveContextBudgetTokens(db, chat) },
    preset,
    modelInfo: config.modelInfo,
    history,
    finalUserAttachments,
    dataDir,
    imageCaptioningEnabled,
    ...(options.captionWarnings ? { captionWarnings: options.captionWarnings } : {}),
  });
  return { config, assembled };
}

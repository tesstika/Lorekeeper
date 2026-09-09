import type { LorekeeperDb } from '../db/client';
import { type AssembledPrompt, buildAssembledPrompt } from '../prompt/assemble';
import type { PromptHistoryMessage } from '../prompt/systemPrompt';
import { getCharacter } from '../services/charactersRepo';
import type { ChatRow } from '../services/chatsRepo';
import { getAttachmentRows, listMessageRows } from '../services/messagesRepo';
import { getPersona } from '../services/personasRepo';
import { getPreset } from '../services/presetsRepo';
import { getPromptTemplate } from '../services/settingsRepo';
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

/**
 * Resolves effective config and assembles the full prompt for `chat`.
 * `cutoffSeq` excludes history at/after it (regenerate target's own group);
 * omit it for a fresh-generate view (prompt preview).
 */
export function loadPromptInputs(
  db: LorekeeperDb,
  dataDir: string,
  chat: ChatRow,
  options: { cutoffSeq?: number } = {},
): PromptInputs {
  const config = resolveGenerationConfig(db, chat);

  const character = getCharacter(db, chat.characterId);
  if (!character) {
    throw new SessionConfigError('not_found', 'The chat character no longer exists');
  }
  const persona = config.personaId ? getPersona(db, config.personaId) : null;
  const preset = config.presetId ? getPreset(db, config.presetId) : null;
  const promptTemplate = getPromptTemplate(db);

  // Active variants with non-empty text only (history inclusion rule, §3.1).
  const cutoffSeq = options.cutoffSeq ?? Number.MAX_SAFE_INTEGER;
  const history: PromptHistoryMessage[] = listMessageRows(db, chat.id)
    .filter((row) => row.isActive && row.text.trim().length > 0 && row.seq < cutoffSeq)
    .map((row) => ({ id: row.id, seq: row.seq, role: row.role, text: row.text }));

  // Final user turn's attachments ride into the multimodal payload.
  const lastUser = [...history].reverse().find((message) => message.role === 'user');
  const finalUserAttachments = lastUser ? getAttachmentRows(db, [lastUser.id]) : [];

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
  });
  return { config, assembled };
}

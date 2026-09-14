import type { LorekeeperDb } from '../db/client';
import {
  estimateTokens,
  type PromptHistoryMessage,
  sanitizeHistoryMarkup,
} from '../prompt/systemPrompt';
import { OLLAMA_BASE_URL, trimTrailingAssistants } from '../providers/ollama';
import { getCharacter } from '../services/charactersRepo';
import type { ChatRow } from '../services/chatsRepo';
import { getPersona } from '../services/personasRepo';
import { getSteppedThinking } from '../services/settingsRepo';
import type { ResolvedGenerationConfig } from './config';

// ---------------------------------------------------------------------------
// Pass 1 — stepped thinking (reasoning helper): a curated Ollama model
// analyzes the scene and drafts a reaction plan that Pass 2 receives as a
// <character_internal_guidance> system block. Runs on the native /api/chat
// endpoint with keep_alive: 0 so the reasoning model unloads from VRAM
// immediately after finishing (prevents exhaustion alongside the RP model).
// ---------------------------------------------------------------------------

export interface ThinkingPassResult {
  /** The reaction plan; null when the pass failed (non-fatal degradation). */
  thought: string | null;
  /** Failure reason for the prompt warnings; null on success. */
  warning: string | null;
}

/**
 * Heuristic native-reasoning detection (feature spec §B.1): models that think
 * on their own (DeepSeek-R1, OpenAI o-series, QwQ, explicit *thinking* ids)
 * bypass Pass 1 to avoid double-thinking, latency and token cost.
 */
export function isNativeReasoningModel(modelId: string): boolean {
  const id = modelId.toLowerCase();
  if (/(^|[/:_-])o[134](-mini|-preview)?([/:_-]|$)/.test(id)) return true;
  if (/deepseek[/_-]?r1/.test(id)) return true;
  if (/(^|[/:_-])qwq([/:_-]|$)/.test(id)) return true;
  return /thinking/.test(id);
}

const THINKING_HISTORY_TOKEN_CAP = 6000;
const THINKING_TIMEOUT_MS = 300_000;

/** Renders the directive's {{char}}/{{user}} placeholders for this chat. */
function renderDirective(directive: string, charName: string, userName: string): string {
  return directive.replaceAll('{{char}}', charName).replaceAll('{{user}}', userName);
}

function characterContext(
  character: {
    name: string;
    description: string;
    personality: string;
    behavior: string;
    scenario: string;
  },
  personaName: string | null,
  personaDescription: string | null,
): string {
  const lines = [
    `Character: ${character.name}`,
    character.description && `Description: ${character.description}`,
    character.personality && `Personality: ${character.personality}`,
    character.behavior && `Behavior: ${character.behavior}`,
    character.scenario && `Scenario: ${character.scenario}`,
    personaName &&
      `The user plays "${personaName}"${personaDescription ? `: ${personaDescription}` : ''}`,
  ].filter((line): line is string => typeof line === 'string' && line.length > 0);
  return lines.join('\n');
}

/**
 * Compiles the Pass 1 wire payload: character context as the system message,
 * recent turns (newest-biased, token-capped), and the DIRECTIVE as the final
 * user turn — reasoning GGUFs follow a last-turn instruction far more
 * reliably than a system message (verified live: system-only framing made
 * Qwythos write a full in-character reply instead of the plan).
 */
export function buildThinkingMessages(
  directive: string,
  characterContextText: string,
  history: PromptHistoryMessage[],
): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    {
      role: 'system',
      content:
        `${characterContextText}\n\n` +
        'Your ONLY job is to plan the next beat of this roleplay. You never write the reply itself.',
    },
  ];
  let budget = THINKING_HISTORY_TOKEN_CAP;
  const recent: PromptHistoryMessage[] = [];
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index];
    if (!message) break;
    const cost = estimateTokens(message.text);
    if (budget - cost < 0 && recent.length > 0) break;
    budget -= cost;
    recent.unshift(message);
  }
  for (const message of recent) {
    messages.push({ role: message.role, content: message.text });
  }
  messages.push({ role: 'user', content: directive });
  return messages;
}

/** Runs Pass 1 against the curated Ollama reasoning model. Never throws. */
export async function runThinkingPass(options: {
  db: LorekeeperDb;
  chat: ChatRow;
  config: ResolvedGenerationConfig;
  history: PromptHistoryMessage[];
  signal: AbortSignal;
}): Promise<ThinkingPassResult> {
  const settings = getSteppedThinking(options.db);
  const model = settings.modelId;
  const character = getCharacter(options.db, options.chat.characterId);
  if (!character) {
    return {
      thought: null,
      warning: 'Stepped thinking skipped: the chat character no longer exists.',
    };
  }
  const persona = options.config.personaId
    ? getPersona(options.db, options.config.personaId)
    : null;
  const messages = buildThinkingMessages(
    renderDirective(settings.directive, character.name, persona?.name ?? 'the user'),
    characterContext(character, persona?.name ?? null, persona?.description ?? null),
    options.history,
  );

  let response: Response;
  try {
    response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: trimTrailingAssistants(messages),
        stream: false,
        keep_alive: 0,
        options: { num_ctx: 8192, num_predict: settings.maxTokens },
      }),
      signal: AbortSignal.any([options.signal, AbortSignal.timeout(THINKING_TIMEOUT_MS)]),
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError')
      return { thought: null, warning: null };
    return {
      thought: null,
      warning: `Stepped thinking failed: Ollama is not reachable (${error instanceof Error ? error.message : String(error)}).`,
    };
  }
  if (!response.ok) {
    let detail = '';
    try {
      const body = (await response.json()) as { error?: unknown } | null;
      if (typeof body?.error === 'string') detail = body.error;
    } catch {
      // keep generic detail
    }
    return {
      thought: null,
      warning: `Stepped thinking failed with HTTP ${response.status}${detail ? `: ${detail}` : ''}.`,
    };
  }
  try {
    const body = (await response.json()) as { message?: { content?: unknown } } | null;
    const raw = typeof body?.message?.content === 'string' ? body.message.content.trim() : '';
    if (raw.length === 0) {
      return {
        thought: null,
        warning: 'Stepped thinking returned an empty plan; continuing without guidance.',
      };
    }
    const thought = sanitizeThought(raw);
    if (thought.length === 0) {
      return {
        thought: null,
        warning: 'Stepped thinking returned only markup; continuing without guidance.',
      };
    }
    return { thought, warning: null };
  } catch {
    return {
      thought: null,
      warning: 'Stepped thinking returned an unreadable response; continuing without guidance.',
    };
  }
}

/**
 * Strips reasoning-model artifacts from a Pass 1 plan before it is stored and
 * injected as guidance (same hygiene as history assembly, plus line
 * collapsing — the plan is 3-6 short analysis lines). Reuses
 * `sanitizeHistoryMarkup` from the prompt layer.
 */
export function sanitizeThought(raw: string): string {
  return sanitizeHistoryMarkup(raw)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n')
    .trim();
}

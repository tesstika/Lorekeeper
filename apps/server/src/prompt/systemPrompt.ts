import type { Character, Persona, PromptTemplate } from '@lorekeeper/shared';
import {
  isFilledVariable,
  type PromptVariableValues,
  renderPromptTemplate,
} from '@lorekeeper/shared';

// ---------------------------------------------------------------------------
// System prompt assembly (plan §4.1) + context budgeting & trimming (§4.3).
// ---------------------------------------------------------------------------

/** Character-based token estimate: chars/4 plus a 5% safety margin (§4.3). */
export function estimateTokens(text: string): number {
  return Math.ceil((text.length / 4) * 1.05);
}

export const EXAMPLE_DIALOGUE_BUDGET_SHARE = 0.25;

const EXAMPLE_DIALOGUE_BLOCK = /<ExampleDialogue>[\s\S]*?<\/ExampleDialogue>/g;
const CONDENSED_NOTICE = '\n[…example dialogue condensed to fit the context budget…]\n';

/**
 * The template embeds `<ExampleDialogue>{{exampleDialogue}}</ExampleDialogue>`.
 * When the character has no example dialogue the whole block is stripped so
 * prompts stay clean; when it exceeds 25% of the context budget it is
 * condensed to a paragraph-boundary prefix (§4.1).
 */
export function resolveExampleDialogue(
  template: string,
  exampleDialogue: string,
  budgetTokens: number,
): { template: string; exampleDialogue: string; condensed: boolean } {
  const filled = isFilledVariable(exampleDialogue);
  if (!filled) {
    return {
      template: template.replace(EXAMPLE_DIALOGUE_BLOCK, ''),
      exampleDialogue: '',
      condensed: false,
    };
  }
  const maxTokens = Math.floor(budgetTokens * EXAMPLE_DIALOGUE_BUDGET_SHARE);
  const maxChars = Math.max(0, Math.floor((maxTokens / 1.05) * 4));
  if (exampleDialogue.length <= maxChars) {
    return { template, exampleDialogue, condensed: false };
  }
  const sliced = exampleDialogue.slice(0, maxChars);
  const lastBreak = Math.max(
    sliced.lastIndexOf('\n\n'),
    sliced.lastIndexOf('\n'),
    sliced.lastIndexOf('. '),
  );
  const cut = lastBreak > maxChars * 0.5 ? sliced.slice(0, lastBreak + 1) : sliced;
  return { template, exampleDialogue: cut.trimEnd() + CONDENSED_NOTICE, condensed: true };
}

export interface SystemRenderInput {
  template: string;
  character: Pick<
    Character,
    | 'name'
    | 'tagline'
    | 'description'
    | 'personality'
    | 'behavior'
    | 'communicationStyle'
    | 'likes'
    | 'dislikes'
    | 'backstory'
    | 'scenario'
    | 'exampleDialogue'
    | 'systemExtras'
  >;
  persona: Pick<Persona, 'name' | 'description'> | null;
  budgetTokens: number;
}

export interface SystemRenderResult {
  systemText: string;
  exampleDialogueCondensed: boolean;
}

export function renderSystemPrompt(input: SystemRenderInput): SystemRenderResult {
  const { template, exampleDialogue, condensed } = resolveExampleDialogue(
    input.template,
    input.character.exampleDialogue,
    input.budgetTokens,
  );
  const personaName = input.persona?.name ?? '';
  const vars: PromptVariableValues = {
    char: input.character.name,
    // {{user}} is the persona name; without a persona a neutral stand-in keeps
    // the template grammar intact.
    user: isFilledVariable(personaName) ? personaName : 'the user',
    tagline: input.character.tagline ?? '',
    description: input.character.description,
    personality: input.character.personality,
    behavior: input.character.behavior,
    communicationStyle: input.character.communicationStyle,
    likes: input.character.likes,
    dislikes: input.character.dislikes,
    backstory: input.character.backstory,
    scenario: input.character.scenario,
    exampleDialogue,
    systemExtras: input.character.systemExtras,
    personaName,
    personaDescription: input.persona?.description ?? '',
  };
  return {
    systemText: renderPromptTemplate(template, vars).trim(),
    exampleDialogueCondensed: condensed,
  };
}

// ---------------------------------------------------------------------------
// Trailing system slot (M1 addendum pinned contract): global
// postHistoryInstructions + '\n\n' + character.jailbreak — jailbreak LAST
// (most specific instruction closest to the generation point). Both empty →
// no trailing system message.
// ---------------------------------------------------------------------------

export function renderTrailingSystemSlot(
  promptTemplate: Pick<PromptTemplate, 'postHistoryInstructions'>,
  characterJailbreak: string,
): string | null {
  const parts: string[] = [];
  if (isFilledVariable(promptTemplate.postHistoryInstructions)) {
    parts.push(promptTemplate.postHistoryInstructions.trim());
  }
  if (isFilledVariable(characterJailbreak)) {
    parts.push(characterJailbreak.trim());
  }
  if (parts.length === 0) return null;
  return parts.join('\n\n');
}

// ---------------------------------------------------------------------------
// History selection (§4.3): greeting (seq 0) is the context anchor; the newest
// user+assistant contiguous block is always kept; older intermediate turns are
// dropped from the oldest side until the estimate fits. Turn pairs are never
// split.
// ---------------------------------------------------------------------------

export interface PromptHistoryMessage {
  id: string;
  seq: number;
  role: 'user' | 'assistant';
  text: string;
}

export interface HistorySelection {
  included: PromptHistoryMessage[];
  droppedCount: number;
}

export interface HistoryBudgetInput {
  /** Model context window; null (unknown metadata) → contextBudget only. */
  modelContextLength: number | null;
  maxTokens: number;
  contextBudgetTokens: number;
  systemText: string;
  trailingSystemText: string | null;
}

/**
 * Budget = min(model.contextLength − maxTokens, globalDefaults.contextBudgetTokens),
 * minus the overhead estimate (system + trailing slot). The final user message
 * lives inside the history and is budgeted there.
 */
export function computeHistoryBudgetTokens(input: HistoryBudgetInput): number {
  const windowBudget =
    input.modelContextLength !== null
      ? input.modelContextLength - input.maxTokens
      : input.contextBudgetTokens;
  const total = Math.min(windowBudget, input.contextBudgetTokens);
  const overhead =
    estimateTokens(input.systemText) +
    (input.trailingSystemText ? estimateTokens(input.trailingSystemText) : 0);
  return Math.max(256, Math.floor(total - overhead));
}

export function estimateHistoryTokens(messages: PromptHistoryMessage[]): number {
  return messages.reduce((sum, message) => sum + estimateTokens(message.text), 0);
}

/**
 * Walks units (a user message plus the assistant reply that immediately
 * follows it — never split) from newest to oldest, including each while the
 * cumulative estimate fits `budgetTokens`. Greeting (seq 0) is always
 * prepended; the newest unit is always kept even when over budget so the
 * model always has the live exchange.
 */
export function selectHistoryForPrompt(
  messages: PromptHistoryMessage[],
  budgetTokens: number,
): HistorySelection {
  if (messages.length === 0) return { included: [], droppedCount: 0 };

  const sorted = [...messages].sort((a, b) => a.seq - b.seq);
  const greeting = sorted[0]?.seq === 0 ? (sorted[0] as PromptHistoryMessage) : null;
  const rest = greeting ? sorted.slice(1) : sorted;

  // Group the remainder into atomic units: a user message optionally followed
  // by its assistant reply; a leading assistant (orphan) stands alone.
  const units: PromptHistoryMessage[][] = [];
  let index = 0;
  while (index < rest.length) {
    const current = rest[index] as PromptHistoryMessage;
    if (current.role === 'user') {
      const next = rest[index + 1];
      if (next && next.role === 'assistant') {
        units.push([current, next]);
        index += 2;
      } else {
        units.push([current]);
        index += 1;
      }
    } else {
      units.push([current]);
      index += 1;
    }
  }

  const newestBlock = units.pop() ?? [];
  let used = newestBlock.reduce((sum, message) => sum + estimateTokens(message.text), 0);
  const keptUnits: PromptHistoryMessage[][] = [];
  let dropped = 0;
  // Strict oldest-side trim (§4.3: "drop oldest blocks until it fits"): the
  // first unit that does not fit ends the walk — everything older is dropped
  // with it, so the kept history is always contiguous.
  for (let u = units.length - 1; u >= 0; u -= 1) {
    const unit = units[u] as PromptHistoryMessage[];
    const unitTokens = unit.reduce((sum, message) => sum + estimateTokens(message.text), 0);
    if (used + unitTokens > budgetTokens) {
      dropped += units.slice(0, u + 1).reduce((sum, remaining) => sum + remaining.length, 0);
      break;
    }
    used += unitTokens;
    keptUnits.push(unit);
  }

  const included: PromptHistoryMessage[] = [];
  if (greeting) included.push(greeting);
  for (const unit of keptUnits.reverse()) included.push(...unit);
  included.push(...newestBlock);
  return { included, droppedCount: dropped };
}

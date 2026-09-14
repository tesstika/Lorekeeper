import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  DEFAULT_THINKING_DIRECTIVE,
  OLLAMA_THINKING_DIRECTIVE_RETIRED,
  OLLAMA_THINKING_MODELS,
} from '@lorekeeper/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app';
import { settings as settingsTable } from '../db/schema';
import type { ResolvedGenerationConfig } from '../generation/config';
import {
  buildThinkingMessages,
  isNativeReasoningModel,
  runThinkingPass,
  sanitizeThought,
} from '../generation/thinking';
import type { PromptHistoryMessage } from '../prompt/systemPrompt';
import { getChatRow } from '../services/chatsRepo';
import { getSteppedThinking } from '../services/settingsRepo';

const dataDir = mkdtempSync(path.join(tmpdir(), 'lorekeeper-thinking-'));
const secretKeyPath = path.join(dataDir, 'secret.key');

let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  process.env.LOREKEEPER_SECRET_KEY_PATH = secretKeyPath;
  app = await buildApp({ dataDir });
  await app.ready();
  await app.inject({
    method: 'PATCH',
    url: '/api/settings',
    payload: {
      globalDefaults: { providerId: 'ollama', modelId: 'mistral-primary' },
      steppedThinking: { enabled: true },
    },
  });
  const character = await app.inject({
    method: 'POST',
    url: '/api/characters',
    payload: { name: 'Vivienne', firstMessage: '*She waits.*' },
  });
  const characterId = (character.json() as { id: string }).id;
  const chat = await app.inject({ method: 'POST', url: '/api/chats', payload: { characterId } });
  const chatId = (chat.json() as { chat: { id: string } }).chat.id;
  (globalThis as { __thinkingChatId?: string }).__thinkingChatId = chatId;
});

afterAll(async () => {
  await app.close();
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    // Windows WAL handles — best-effort cleanup.
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const chatId = (): string => (globalThis as { __thinkingChatId?: string }).__thinkingChatId ?? '';

function stubFetch(routes: Record<string, (body: string) => Response>): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const payload = typeof init?.body === 'string' ? init.body : '';
    for (const [fragment, handler] of Object.entries(routes)) {
      if (url.includes(fragment)) return handler(payload);
    }
    throw new Error(`Unexpected fetch in test: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('isNativeReasoningModel', () => {
  it('detects DeepSeek-R1, OpenAI o-series, QwQ and thinking ids', () => {
    expect(isNativeReasoningModel('deepseek/deepseek-r1')).toBe(true);
    expect(isNativeReasoningModel('deepseek-r1-distill-qwen-14b')).toBe(true);
    expect(isNativeReasoningModel('openai/o1')).toBe(true);
    expect(isNativeReasoningModel('openai/o3-mini')).toBe(true);
    expect(isNativeReasoningModel('qwen/qwq-32b')).toBe(true);
    expect(isNativeReasoningModel('qwen3.8-27b-thinking')).toBe(true);
  });

  it('does not flag ordinary narrative models', () => {
    expect(isNativeReasoningModel('hf.co/Bluerosesbutterfly/Huihui-Mistral-24B')).toBe(false);
    expect(isNativeReasoningModel('anthropic/claude-3.5-sonnet')).toBe(false);
    expect(isNativeReasoningModel('mistral-primary')).toBe(false);
    // 'o1' must be a discrete segment, not a substring.
    expect(isNativeReasoningModel('rocinante-16b')).toBe(false);
  });
});

describe('buildThinkingMessages', () => {
  it('renders the directive as the final user turn after context + recent history', () => {
    const messages = buildThinkingMessages(
      'Think step by step about Vivienne and Mike.',
      'Character: Vivienne\nPersonality: Observant.\nThe user plays "Mike": a tall, goofy guy.',
      [
        { id: 'a', seq: 0, role: 'assistant', text: 'Hi.' },
        { id: 'b', seq: 1, role: 'user', text: 'Do you see this image?' },
      ],
    );
    expect(messages).toHaveLength(4);
    expect(messages[0]?.role).toBe('system');
    expect(messages[0]?.content).toContain('Character: Vivienne');
    expect(messages[0]?.content).toContain('You never write the reply itself');
    expect(messages[1]).toEqual({ role: 'assistant', content: 'Hi.' });
    expect(messages[2]).toEqual({ role: 'user', content: 'Do you see this image?' });
    // The directive rides as the FINAL user turn — reasoning GGUFs follow
    // last-turn instructions far more reliably than system framing.
    expect(messages[3]).toEqual({
      role: 'user',
      content: 'Think step by step about Vivienne and Mike.',
    });
  });

  it('caps history to the token budget while always keeping the newest turn', () => {
    const history: PromptHistoryMessage[] = Array.from({ length: 40 }, (_, index) => ({
      id: `m${index}`,
      seq: index,
      role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
      text: 'x'.repeat(6000),
    }));
    const messages = buildThinkingMessages('d', 'ctx', history);
    // System message + directive + a small newest-biased subset (far fewer
    // than 40). The directive is always the final turn.
    expect(messages.length).toBeLessThan(11);
    expect(messages.at(-1)?.role).toBe('user');
    expect(messages.at(-1)?.content).toBe('d');
    expect(messages.at(-2)?.content).toBe(history.at(-1)?.text);
  });

  it('heals stored rows still carrying the retired "inner mind" directive', () => {
    // Simulate a pre-fix install row (upsert: the harness row already exists).
    app.db
      .insert(settingsTable)
      .values({
        key: 'steppedThinking',
        value: {
          enabled: true,
          providerId: 'ollama',
          modelId: OLLAMA_THINKING_MODELS[0].tag,
          maxTokens: 1024,
          directive: OLLAMA_THINKING_DIRECTIVE_RETIRED,
        },
        updatedAt: new Date().toISOString(),
      })
      .onConflictDoUpdate({
        target: settingsTable.key,
        set: {
          value: {
            enabled: true,
            providerId: 'ollama',
            modelId: OLLAMA_THINKING_MODELS[0].tag,
            maxTokens: 1024,
            directive: OLLAMA_THINKING_DIRECTIVE_RETIRED,
          },
          updatedAt: new Date().toISOString(),
        },
      })
      .run();
    const healed = getSteppedThinking(app.db);
    expect(healed.directive).toBe(DEFAULT_THINKING_DIRECTIVE);
    expect(healed.directive).toContain('story analyst');
    // Restore the clean row — later tests read this section.
    app.sqlite.run("DELETE FROM settings WHERE key = 'steppedThinking'");
  });
});

describe('sanitizeThought', () => {
  it('strips reasoning-model markup: think blocks, fake tool calls, actions, wrapper echoes', () => {
    const raw = [
      '<think>The user wants tea. Plan the reaction.</think>',
      '<TOOL_CALLS>[stalk]</TOOL_CALLS>',
      '<action>She sips the mug.</action>',
      '<character_internal_guidance>',
      'Annie wants warmth but will not admit it; deflect with teasing.',
      '</character_internal_guidance>',
    ].join('\n');
    const cleaned = sanitizeThought(raw);
    expect(cleaned).not.toContain('<');
    expect(cleaned).not.toContain('>');
    expect(cleaned).not.toContain('think');
    expect(cleaned).toContain('Annie wants warmth but will not admit it');
    // The think-block reasoning was removed with its wrapper.
    expect(cleaned).not.toContain('Plan the reaction');
  });

  it('strips bracket-form artifact tokens like [TOOL_CALLS] (observed live)', () => {
    const raw = [
      'After she sips the mug again, she settles it beside her.',
      '[TOOL_CALLS]',
      '"Oh, hey, now that I am thinking about it — I really need to hit the gym."',
    ].join('\n');
    const cleaned = sanitizeThought(raw);
    expect(cleaned).not.toContain('[TOOL_CALLS]');
    expect(cleaned).toContain('After she sips the mug again, she settles it beside her.');
    expect(cleaned).toContain('I really need to hit the gym.');
  });

  it('collapses blank lines left behind by removed markup', () => {
    const cleaned = sanitizeThought('<a>\n\n\nGoal: hold the moment.</a>\n\n\n');
    expect(cleaned).toBe('Goal: hold the moment.');
  });
});

describe('runThinkingPass', () => {
  it('returns the trimmed plan using the settings model, prompt options and keep_alive: 0', async () => {
    const thinkingTag = OLLAMA_THINKING_MODELS[0].tag;
    const fetchMock = stubFetch({
      '/api/chat': (_body) =>
        new Response(JSON.stringify({ message: { role: 'assistant', content: '  The plan.  ' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    });
    const result = await runThinkingPass({
      db: app.db,
      chat: getChatRow(app.db, chatId()) as never,
      config: { personaId: null } as ResolvedGenerationConfig,
      history: [{ id: 'a', seq: 1, role: 'user', text: 'Hello there.' }],
      signal: new AbortController().signal,
    });
    expect(result.thought).toBe('The plan.');
    expect(result.warning).toBeNull();

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as {
      model?: string;
      keep_alive?: number;
      stream?: boolean;
      options?: { num_ctx?: number; num_predict?: number };
    };
    expect(body.model).toBe(thinkingTag);
    expect(body.keep_alive).toBe(0);
    expect(body.stream).toBe(false);
    expect(body.options).toEqual({ num_ctx: 8192, num_predict: 1024 });
  });

  it('degrades gracefully when Ollama is unreachable', async () => {
    stubFetch({
      '/api/chat': () => {
        throw new Error('connect ECONNREFUSED');
      },
    });
    const result = await runThinkingPass({
      db: app.db,
      chat: getChatRow(app.db, chatId()) as never,
      config: { personaId: null } as ResolvedGenerationConfig,
      history: [],
      signal: new AbortController().signal,
    });
    expect(result.thought).toBeNull();
    expect(result.warning).toContain('not reachable');
  });

  it('degrades gracefully on an empty plan', async () => {
    stubFetch({
      '/api/chat': () =>
        new Response(JSON.stringify({ message: { role: 'assistant', content: '  ' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    });
    const result = await runThinkingPass({
      db: app.db,
      chat: getChatRow(app.db, chatId()) as never,
      config: { personaId: null } as ResolvedGenerationConfig,
      history: [],
      signal: new AbortController().signal,
    });
    expect(result.thought).toBeNull();
    expect(result.warning).toContain('empty plan');
  });
});

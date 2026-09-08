import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DEFAULT_SYSTEM_TEMPLATE } from '@lorekeeper/shared';
import { describe, expect, it } from 'vitest';
import { buildAssembledPrompt, FALLBACK_PRESET } from '../prompt/assemble';
import {
  computeHistoryBudgetTokens,
  estimateTokens,
  type PromptHistoryMessage,
  renderSystemPrompt,
  renderTrailingSystemSlot,
  resolveExampleDialogue,
  selectHistoryForPrompt,
} from '../prompt/systemPrompt';

function makeCharacter(
  overrides: Partial<Parameters<typeof renderSystemPrompt>[0]['character']> = {},
) {
  return {
    name: 'Lady Vivienne de Valois',
    tagline: 'Victorian Occultist & Archival Heiress',
    description: 'A moody occultist.',
    personality: 'Sharp-witted.',
    behavior: 'Swans about.',
    communicationStyle: 'Formal.',
    likes: 'Rain',
    dislikes: 'Silver',
    backstory: 'Heiress of Valois.',
    scenario: 'A haunted manor.',
    exampleDialogue: '*Vivienne curtsies.* "Welcome to Valois Manor."',
    systemExtras: 'Stay in period voice.',
    ...overrides,
  };
}

function msg(seq: number, role: 'user' | 'assistant', text: string): PromptHistoryMessage {
  return { id: `m${seq}`, seq, role, text };
}

describe('trailing system slot (pinned contract, M1 addendum)', () => {
  it('composes PHI + jailbreak with the character jailbreak LAST', () => {
    const slot = renderTrailingSystemSlot(
      { postHistoryInstructions: 'Global instructions here.' },
      'Per-character jailbreak text.',
    );
    expect(slot).toBe('Global instructions here.\n\nPer-character jailbreak text.');
    expect(slot?.indexOf('Per-character')).toBeGreaterThan(slot?.indexOf('Global') ?? 0);
  });

  it('uses the jailbreak alone when PHI is empty', () => {
    expect(renderTrailingSystemSlot({ postHistoryInstructions: '' }, 'JB')).toBe('JB');
  });

  it('omits the trailing system message when both are empty', () => {
    expect(renderTrailingSystemSlot({ postHistoryInstructions: '   ' }, '')).toBeNull();
  });
});

describe('system prompt rendering', () => {
  it('renders the default template with character + persona variables', () => {
    const { systemText } = renderSystemPrompt({
      template: DEFAULT_SYSTEM_TEMPLATE,
      character: makeCharacter(),
      persona: { name: 'Julian', description: 'A visiting detective.' },
      budgetTokens: 8192,
    });
    expect(systemText).toContain(
      'You are Lady Vivienne de Valois in an ongoing roleplay with Julian.',
    );
    expect(systemText).toContain('Tagline: Victorian Occultist');
    expect(systemText).toContain('<ExampleDialogue>');
    expect(systemText).toContain('Julian: A visiting detective.');
    expect(systemText).toContain('Stay in period voice.');
  });

  it('omits the {{#tagline}} section for empty taglines', () => {
    const { systemText } = renderSystemPrompt({
      template: DEFAULT_SYSTEM_TEMPLATE,
      character: makeCharacter({ tagline: null }),
      persona: null,
      budgetTokens: 8192,
    });
    expect(systemText).not.toContain('Tagline:');
    expect(systemText).toContain('with the user.');
  });

  it('strips the whole <ExampleDialogue> block when empty', () => {
    const { systemText } = renderSystemPrompt({
      template: DEFAULT_SYSTEM_TEMPLATE,
      character: makeCharacter({ exampleDialogue: '' }),
      persona: null,
      budgetTokens: 8192,
    });
    expect(systemText).not.toContain('<ExampleDialogue>');
  });

  it('condenses example dialogue beyond 25% of the budget', () => {
    const huge = 'Hello there.\n\n'.repeat(4000); // ~52k chars ≈ 13k tokens
    const result = resolveExampleDialogue(DEFAULT_SYSTEM_TEMPLATE, huge, 8192);
    expect(result.condensed).toBe(true);
    expect(result.exampleDialogue).toContain('condensed');
    expect(result.exampleDialogue.length).toBeLessThan(huge.length / 4);

    const small = 'Hello there.';
    expect(resolveExampleDialogue(DEFAULT_SYSTEM_TEMPLATE, small, 8192).condensed).toBe(false);
  });
});

describe('context budget & trimming (§4.3)', () => {
  it('budgets as min(contextLength − maxTokens, contextBudget) minus overhead', () => {
    const system = 's'.repeat(400); // ≈105 tokens
    const budget = computeHistoryBudgetTokens({
      modelContextLength: 8000,
      maxTokens: 1000,
      contextBudgetTokens: 8192,
      systemText: system,
      trailingSystemText: 't'.repeat(200),
    });
    const expected =
      Math.min(8000 - 1000, 8192) - Math.ceil((400 / 4) * 1.05) - Math.ceil((200 / 4) * 1.05);
    expect(budget).toBe(expected);
  });

  it('falls back to the context budget when model context is unknown', () => {
    const budget = computeHistoryBudgetTokens({
      modelContextLength: null,
      maxTokens: 1000,
      contextBudgetTokens: 4096,
      systemText: '',
      trailingSystemText: null,
    });
    expect(budget).toBe(4096);
  });

  it('estimateTokens uses chars/4 + 5% safety margin', () => {
    expect(estimateTokens('x'.repeat(400))).toBe(105);
  });

  it('keeps the greeting anchor and never splits turn pairs', () => {
    const history = [
      msg(0, 'assistant', 'g'.repeat(80)), // greeting
      msg(1, 'user', 'u1 '.repeat(200)),
      msg(2, 'assistant', 'a1 '.repeat(200)),
      msg(3, 'user', 'u2 '.repeat(200)),
      msg(4, 'assistant', 'a2 '.repeat(200)),
      msg(5, 'user', 'newest user message'),
    ];
    const { included } = selectHistoryForPrompt(history, estimateTokens('x'.repeat(2400)));
    const seqs = included.map((m) => m.seq);
    expect(seqs).toContain(0); // greeting anchor
    expect(seqs).toContain(5); // newest user
    expect(seqs).toContain(4); // newest assistant block
    // Pairs are atomic: either both of (1,2) survive or neither.
    const has1 = seqs.includes(1);
    const has2 = seqs.includes(2);
    expect(has1).toBe(has2);
    // Newest-to-oldest fill: when a pair is dropped, older ones are too.
    const firstDropped = [1, 2, 3, 4].find((seq) => !seqs.includes(seq));
    if (firstDropped !== undefined) {
      for (let seq = 1; seq < firstDropped; seq += 1) expect(seqs).toContain(seq);
    }
  });

  it('always includes the newest block even when it alone busts the budget', () => {
    const history = [msg(0, 'assistant', 'greeting'), msg(1, 'user', 'u'.repeat(4000))];
    const { included, droppedCount } = selectHistoryForPrompt(history, 10);
    expect(included.map((m) => m.seq).sort((a, b) => a - b)).toEqual([0, 1]);
    expect(droppedCount).toBe(0);
  });

  it('drops whole pairs from the oldest side when the budget runs out', () => {
    const history = [
      msg(0, 'assistant', 'g'),
      msg(1, 'user', 'x'.repeat(100)),
      msg(2, 'assistant', 'y'.repeat(100)),
      msg(3, 'user', 'three'),
    ];
    // Tiny budget: greeting (1) + newest block (2) + 2 slack; the old pair
    // (~54 tokens) cannot fit and drops atomically.
    const budget = estimateTokens('g') + estimateTokens('three') + 2;
    const { included, droppedCount } = selectHistoryForPrompt(history, budget);
    expect(included.map((m) => m.seq)).toEqual([0, 3]);
    expect(droppedCount).toBe(2);
  });

  it('keeps the selected history contiguous — a small orphan cannot survive a dropped newer unit (audit regression)', () => {
    // greeting@0 | orphan user@1 (small) | big pair@2,3 | newest pair@4,5.
    // Budget fits greeting + newest + the small orphan, but not the big pair.
    const history = [
      msg(0, 'assistant', 'g'),
      msg(1, 'user', 'A'.repeat(50)),
      msg(2, 'user', 'B'.repeat(2400)),
      msg(3, 'assistant', 'B'.repeat(2400)),
      msg(4, 'user', 'C'.repeat(50)),
      msg(5, 'assistant', 'C'.repeat(50)),
    ];
    const budget =
      estimateTokens('g') +
      estimateTokens('C'.repeat(50)) * 2 +
      estimateTokens('A'.repeat(50)) +
      20;
    const { included } = selectHistoryForPrompt(history, budget);
    const seqs = included.map((m) => m.seq);
    // Strict oldest-side trim: no hole between the greeting and the newest block.
    const middle = seqs.filter((seq) => seq !== 0).sort((a, b) => a - b);
    const first = middle[0] ?? 0;
    const last = middle.at(-1) ?? 0;
    expect(last - first + 1).toBe(middle.length);
  });
});

describe('multimodal request assembly (§4.2)', () => {
  it('orders content parts text-first then images as data URLs', () => {
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0,
      0, 1, 8, 6, 0, 0, 0, 0x1f, 0x15, 0xc4, 0x89,
    ]);
    const attachmentRow = {
      id: 'att1',
      messageId: 'm1',
      filePath: 'media/att1.png',
      originalName: 'photo.png',
      mimeType: 'image/png',
      width: 1,
      height: 1,
      sizeBytes: png.length,
      createdAt: '2026-09-08T00:00:00.000Z',
    };

    // Missing file on disk → skipped with a warning, text-only turn.
    const missing = buildAssembledPrompt({
      character: makeCharacter() as never,
      persona: null,
      promptTemplate: { systemTemplate: 'You are {{char}}.', postHistoryInstructions: '' },
      globalDefaults: { contextBudgetTokens: 8192 },
      preset: null,
      modelInfo: { id: 'm', name: 'M', contextLength: 32000, inputModalities: ['text', 'image'] },
      history: [msg(1, 'user', 'Look at this photo')],
      finalUserAttachments: [attachmentRow],
      dataDir: tmpdir(),
    });
    expect(missing.request.messages[0]?.role).toBe('system');
    expect(missing.warnings.join(' ')).toContain('could not be read');

    // With a real file on disk the parts order is text → image.
    const dir = mkdtempSync(path.join(tmpdir(), 'lk-media-'));
    mkdirSync(path.join(dir, 'media'), { recursive: true });
    writeFileSync(path.join(dir, 'media', 'att1.png'), png);
    try {
      const withImage = buildAssembledPrompt({
        character: makeCharacter() as never,
        persona: null,
        promptTemplate: { systemTemplate: 'You are {{char}}.', postHistoryInstructions: '' },
        globalDefaults: { contextBudgetTokens: 8192 },
        preset: null,
        modelInfo: { id: 'm', name: 'M', contextLength: 32000, inputModalities: ['text', 'image'] },
        history: [msg(1, 'user', 'Look at this photo')],
        finalUserAttachments: [attachmentRow],
        dataDir: dir,
      });
      const finalTurn = withImage.request.messages.at(-1);
      expect(Array.isArray(finalTurn?.content)).toBe(true);
      const parts = finalTurn?.content as Array<{ type: string }>;
      expect(parts[0]?.type).toBe('text');
      expect(parts[1]?.type).toBe('image_url');
      expect(String((parts[1] as unknown as { imageUrl: { url: string } }).imageUrl.url)).toContain(
        'data:image/png;base64,',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('warns (but allows) when the model lacks image metadata (A1)', () => {
    const assembled = buildAssembledPrompt({
      character: makeCharacter() as never,
      persona: null,
      promptTemplate: { systemTemplate: 'S', postHistoryInstructions: '' },
      globalDefaults: { contextBudgetTokens: 8192 },
      preset: null,
      modelInfo: null,
      history: [msg(1, 'user', 'hi')],
      finalUserAttachments: [],
      dataDir: tmpdir(),
    });
    expect(assembled.warnings.some((w) => w.includes('context length is unknown'))).toBe(true);
  });

  it('falls back to preset-schema sampling values when no preset exists (D-S1)', () => {
    const assembled = buildAssembledPrompt({
      character: makeCharacter() as never,
      persona: null,
      promptTemplate: { systemTemplate: 'S', postHistoryInstructions: '' },
      globalDefaults: { contextBudgetTokens: 8192 },
      preset: null,
      modelInfo: null,
      history: [msg(1, 'user', 'hi')],
      finalUserAttachments: [],
      dataDir: tmpdir(),
    });
    expect(assembled.request.temperature).toBe(FALLBACK_PRESET.temperature);
    expect(assembled.request.maxTokens).toBe(FALLBACK_PRESET.maxTokens);
    expect(assembled.request.topK).toBeUndefined();
  });
});

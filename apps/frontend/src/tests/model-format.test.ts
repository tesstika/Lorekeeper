import { describe, expect, it } from 'vitest';
import { formatShortModelName } from '../utils/model-format';

describe('formatShortModelName', () => {
  it('maps the curated Ollama tags to their friendly names', () => {
    expect(
      formatShortModelName(
        'hf.co/Bluerosesbutterfly/Huihui-Mistral-Small-3.2-24B-Instruct-2506-abliterated-llamacppfixed.i1-Q4_K_M',
      ),
    ).toBe('Mistral Small 3.2 24B · Q4_K_M');
    expect(
      formatShortModelName('hf.co/jwhisenhunt/Cydonia-24B-v4.3-absolute-heresy-Q4_K_M-GGUF'),
    ).toBe('Cydonia 24B v4.3 · Q4_K_M');
    expect(formatShortModelName('hf.co/BeaverAI/Rocinante-XL-16B-v1b-GGUF:Q4_K_M')).toBe(
      'Rocinante-XL 16B · Q4_K_M',
    );
    expect(formatShortModelName('moondream:latest')).toBe('Moondream2 2B');
    expect(formatShortModelName('moondream')).toBe('Moondream2 2B');
  });

  it('strips redundant vendor prefixes from cloud ids', () => {
    expect(formatShortModelName('openrouter/anthropic/claude-3.5-sonnet')).toBe(
      'Claude 3.5 Sonnet',
    );
    expect(formatShortModelName('anthropic/claude-5-sonnet')).toBe('Claude 5 Sonnet');
    expect(formatShortModelName('meta-llama/llama-3.3-70b-instruct')).toBe('Llama 3.3 70B');
    expect(formatShortModelName('gpt-4o')).toBe('GPT 4o');
  });

  it('normalizes :latest and :free variants', () => {
    expect(formatShortModelName('anthropic/claude-3.5-haiku:free')).toBe('Claude 3.5 Haiku');
  });

  it('keeps quant suffixes readable for unknown hf.co tags', () => {
    expect(formatShortModelName('hf.co/someorg/Some-Model-8x7B-v2-Q5_K_M')).toBe(
      'Some Model 8x7B v2 Q5_K_M',
    );
  });

  it('leaves empty ids untouched and capitalizes plain ids', () => {
    expect(formatShortModelName('')).toBe('');
    expect(formatShortModelName('mistral')).toBe('Mistral');
  });
});

import type { ModelInfo } from '@lorekeeper/shared';

/** 200000 → "200k", 1048576 → "1.0M" — for model library tags. */
export function formatContextLength(contextLength: number | null): string | null {
  if (contextLength === null || !Number.isFinite(contextLength) || contextLength <= 0) return null;
  if (contextLength >= 1_000_000) {
    const millions = contextLength / 1_000_000;
    return `${millions % 1 === 0 ? millions.toFixed(0) : millions.toFixed(1)}M`;
  }
  if (contextLength >= 1000) return `${Math.round(contextLength / 1000)}k`;
  return String(contextLength);
}

/** Prices are USD per token (OpenRouter metadata); displayed per million tokens. */
export function formatPricePerMillion(price: number | undefined): string | null {
  // Negative values are provider sentinels for "unknown/variable" pricing
  // (e.g. openrouter/auto publishes -1) — hide them rather than guess.
  if (price === undefined || !Number.isFinite(price) || price < 0) return null;
  const perMillion = price * 1_000_000;
  if (perMillion === 0) return 'free';
  if (perMillion < 0.01) return `$${perMillion.toPrecision(2)}/M`;
  return `$${perMillion.toFixed(2)}/M`;
}

export function isVisionModel(model: ModelInfo): boolean {
  return model.inputModalities?.includes('image') ?? false;
}

/** Empty modalities = provider published no metadata (A1) → allow with warning. */
export function modalityUnknown(model: ModelInfo): boolean {
  return (model.inputModalities?.length ?? 0) === 0;
}

export function formatModelPricing(model: ModelInfo): string | null {
  const prompt = formatPricePerMillion(model.promptPrice);
  const completion = formatPricePerMillion(model.completionPrice);
  if (prompt === null && completion === null) return null;
  const promptText = prompt ?? '?';
  const completionText = completion ?? '?';
  if (promptText === 'free' && completionText === 'free') return 'free';
  return `${promptText} in · ${completionText} out`;
}

/** 14_111_222_333 → "14.1 GB", 24_500_000 → "24.5 MB" — model download sizes. */
export function formatBytes(bytes: number | null): string | null {
  if (bytes === null || !Number.isFinite(bytes) || bytes <= 0) return null;
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/**
 * Friendly short names for the curated Ollama whitelist — the tags mirror
 * OLLAMA_CURATED_MODELS in apps/server/src/providers/ollama.ts (kept in sync
 * manually; the server owns the download catalog, the frontend owns display).
 */
const OLLAMA_SHORT_NAMES: Record<string, string> = {
  'hf.co/Bluerosesbutterfly/Huihui-Mistral-Small-3.2-24B-Instruct-2506-abliterated-llamacppfixed.i1-Q4_K_M':
    'Mistral Small 3.2 24B · Q4_K_M',
  'hf.co/jwhisenhunt/Cydonia-24B-v4.3-absolute-heresy-Q4_K_M-GGUF': 'Cydonia 24B v4.3 · Q4_K_M',
  'hf.co/BeaverAI/Rocinante-XL-16B-v1b-GGUF:Q4_K_M': 'Rocinante-XL 16B · Q4_K_M',
  moondream: 'Moondream2 2B',
  'moondream:latest': 'Moondream2 2B',
};

/** Tokens that read as acronyms, not words (gpt-4o → "GPT 4o"). */
const ACRONYM_TOKENS = new Set(['ai', 'gpt']);

/** "claude-3.5-sonnet" → "Claude 3.5 Sonnet"; "llama-3.3-70b" → "Llama 3.3 70B". */
function prettifyModelTail(tail: string): string {
  // Quant segments (q4_k_m) read better intact than as "Q4 K M".
  const words = tail
    .split('-')
    .flatMap((segment) => (/^q\d/i.test(segment) ? [segment.toUpperCase()] : segment.split('_')))
    .filter((word) => word.length > 0);
  // The size token already identifies the variant — "…70b-instruct" → "…70B".
  if (words.length > 1 && words[words.length - 1]?.toLowerCase() === 'instruct') words.pop();
  return words
    .map((word) => {
      if (/^q\d/i.test(word)) return word.toUpperCase(); // quant suffixes stay intact: Q4_K_M
      const sized = word.replace(/^(\d+(?:\.\d+)?)b$/i, '$1B'); // 70b → 70B
      if (sized !== word) return sized;
      if (ACRONYM_TOKENS.has(word.toLowerCase())) return word.toUpperCase();
      if (/^[A-Z]/.test(word) || /^v\d/i.test(word)) return word; // "XL", "v4.3"
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

/**
 * A clean, human-readable badge name for a raw model id: curated Ollama tags
 * map to their friendly names, cloud ids lose redundant vendor prefixes
 * (`openrouter/anthropic/claude-3.5-sonnet` → "Claude 3.5 Sonnet"). The full
 * id remains visible in tooltips and the settings UI.
 */
export function formatShortModelName(modelId: string): string {
  const trimmed = modelId.trim();
  if (trimmed.length === 0) return trimmed;
  const curated =
    OLLAMA_SHORT_NAMES[trimmed] ??
    (trimmed.endsWith(':latest')
      ? OLLAMA_SHORT_NAMES[trimmed.slice(0, -':latest'.length)]
      : undefined);
  if (curated) return curated;
  const segments = trimmed.split('/').filter((segment) => segment.length > 0);
  const tail = segments[segments.length - 1] ?? trimmed;
  return prettifyModelTail(tail.replace(/:free$/i, ''));
}

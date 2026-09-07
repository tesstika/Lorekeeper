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
  if (price === undefined || !Number.isFinite(price)) return null;
  const perMillion = price * 1_000_000;
  if (perMillion === 0) return 'free';
  if (perMillion < 0.01) return `$${perMillion.toPrecision(2)}/M`;
  return `$${perMillion.toFixed(2)}/M`;
}

export function isVisionModel(model: ModelInfo): boolean {
  return model.inputModalities.includes('image');
}

/** Empty modalities = provider published no metadata (A1) → allow with warning. */
export function modalityUnknown(model: ModelInfo): boolean {
  return model.inputModalities.length === 0;
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

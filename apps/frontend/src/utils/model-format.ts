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

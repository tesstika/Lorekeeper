export const providerIds = ['openrouter', 'unorouter', 'ollama'] as const;
export type ProviderId = (typeof providerIds)[number];

export const chatStatuses = ['in_progress', 'archived'] as const;
export type ChatStatus = (typeof chatStatuses)[number];

export const messageRoles = ['user', 'assistant'] as const;
export type MessageRole = (typeof messageRoles)[number];

export const finishReasons = ['stop', 'length', 'aborted', 'error'] as const;
export type FinishReason = (typeof finishReasons)[number];

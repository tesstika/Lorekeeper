import type {
  ChatError,
  ChatStatus,
  FinishReason,
  MessageRole,
  ProviderId,
  TokenUsage,
} from '@lorekeeper/shared';
import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const characters = sqliteTable('characters', {
  id: text().primaryKey(),
  name: text().notNull(),
  tagline: text(),
  tags: text({ mode: 'json' }).$type<string[]>().notNull().default([]),
  avatarPath: text(),
  description: text().notNull().default(''),
  creatorNotes: text().notNull().default(''),
  extensions: text({ mode: 'json' }).$type<Record<string, unknown>>().notNull().default({}),
  personality: text().notNull().default(''),
  behavior: text().notNull().default(''),
  communicationStyle: text().notNull().default(''),
  likes: text().notNull().default(''),
  dislikes: text().notNull().default(''),
  backstory: text().notNull().default(''),
  scenario: text().notNull().default(''),
  exampleDialogue: text().notNull().default(''),
  firstMessage: text().notNull().default(''),
  alternateGreetings: text({ mode: 'json' }).$type<string[]>().notNull().default([]),
  systemExtras: text().notNull().default(''),
  jailbreak: text().notNull().default(''),
  createdAt: text().notNull(),
  updatedAt: text().notNull(),
});

export const personas = sqliteTable('personas', {
  id: text().primaryKey(),
  name: text().notNull(),
  description: text().notNull().default(''),
  avatarPath: text(),
  isDefault: integer({ mode: 'boolean' }).notNull().default(false),
  createdAt: text().notNull(),
  updatedAt: text().notNull(),
});

export const presets = sqliteTable('presets', {
  id: text().primaryKey(),
  name: text().notNull(),
  description: text().notNull().default(''),
  temperature: real().notNull().default(0.85),
  topP: real().notNull().default(0.92),
  topK: integer(),
  maxTokens: integer().notNull().default(4096),
  frequencyPenalty: real().notNull().default(0.0),
  presencePenalty: real().notNull().default(0.0),
  repetitionPenalty: real(),
  stopSequences: text({ mode: 'json' }).$type<string[]>().notNull().default([]),
  isDefault: integer({ mode: 'boolean' }).notNull().default(false),
  createdAt: text().notNull(),
  updatedAt: text().notNull(),
});

export const chats = sqliteTable('chats', {
  id: text().primaryKey(),
  characterId: text()
    .notNull()
    .references(() => characters.id, { onDelete: 'restrict' }),
  personaId: text().references(() => personas.id, { onDelete: 'set null' }),
  personaNone: integer({ mode: 'boolean' }).notNull().default(false),
  title: text().notNull(),
  ribbon: text(),
  status: text().$type<ChatStatus>().notNull().default('in_progress'),
  providerId: text().$type<ProviderId>(),
  modelId: text(),
  presetId: text().references(() => presets.id, { onDelete: 'set null' }),
  // Per-chat context budget override (M4, plan §6.2); null → global defaults.
  contextBudgetTokens: integer(),
  lastMessageAt: text().notNull(),
  lastMessagePreview: text(),
  createdAt: text().notNull(),
});

export const messages = sqliteTable(
  'messages',
  {
    id: text().primaryKey(),
    chatId: text()
      .notNull()
      .references(() => chats.id, { onDelete: 'cascade' }),
    seq: integer().notNull(),
    role: text().$type<MessageRole>().notNull(),
    text: text().notNull().default(''),
    groupId: text(),
    variantIndex: integer(),
    isActive: integer({ mode: 'boolean' }).notNull().default(true),
    isGreeting: integer({ mode: 'boolean' }).notNull().default(false),
    providerId: text().$type<ProviderId>(),
    modelId: text(),
    finishReason: text().$type<FinishReason>(),
    isError: integer({ mode: 'boolean' }).notNull().default(false),
    error: text({ mode: 'json' }).$type<ChatError | null>(),
    usage: text({ mode: 'json' }).$type<TokenUsage | null>(),
    createdAt: text().notNull(),
  },
  (t) => [index('idx_messages_chat_seq').on(t.chatId, t.seq)],
);

export const attachments = sqliteTable('attachments', {
  id: text().primaryKey(),
  messageId: text().references(() => messages.id, { onDelete: 'cascade' }),
  filePath: text().notNull(),
  originalName: text().notNull(),
  mimeType: text().notNull(),
  width: integer(),
  height: integer(),
  sizeBytes: integer().notNull(),
  /** Vision-helper description (Moondream2 via Ollama); null until captioned. */
  caption: text(),
  createdAt: text().notNull(),
});

export const settings = sqliteTable('settings', {
  key: text().primaryKey(),
  value: text({ mode: 'json' }).$type<unknown>().notNull(),
  updatedAt: text().notNull(),
});

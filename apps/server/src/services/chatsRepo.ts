import type { AttachmentInfo, CreateChatInput } from '@lorekeeper/shared';
import { and, desc, eq, or, sql } from 'drizzle-orm';
import type { LorekeeperDb } from '../db/client';
import { characters, chats, messages, personas } from '../db/schema';
import {
  type AttachmentRow,
  getAttachmentRows,
  listMessageRows,
  type MessageRow,
} from './messagesRepo';

export type ChatRow = typeof chats.$inferSelect;
export type CharacterRow = typeof characters.$inferSelect;
export type PersonaRow = typeof personas.$inferSelect;
/** Partial patch whose optional keys also accept explicit `undefined`. */
export type ChatUpdate = { [K in keyof ChatRow]?: ChatRow[K] | undefined };

export class ChatRepoError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ChatRepoError';
    this.code = code;
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

export function toChat(row: ChatRow) {
  return {
    id: row.id,
    characterId: row.characterId,
    personaId: row.personaId,
    title: row.title,
    ribbon: row.ribbon,
    status: row.status,
    providerId: row.providerId,
    modelId: row.modelId,
    presetId: row.presetId,
    lastMessageAt: row.lastMessageAt,
    lastMessagePreview: row.lastMessagePreview,
    createdAt: row.createdAt,
  };
}

export function getChatRow(db: LorekeeperDb, id: string): ChatRow | null {
  return db.select().from(chats).where(eq(chats.id, id)).all()[0] ?? null;
}

export interface ChatSummaryRecord {
  id: string;
  title: string;
  personaId: string | null;
  ribbon: string | null;
  status: 'in_progress' | 'archived';
  providerId: 'openrouter' | 'unorouter' | null;
  modelId: string | null;
  presetId: string | null;
  lastMessageAt: string;
  lastMessagePreview: string | null;
  createdAt: string;
  characterName: string;
  characterAvatarPath: string | null;
}

export function listChats(
  db: LorekeeperDb,
  filter: { status?: 'in_progress' | 'archived' | undefined; q?: string | undefined } = {},
): ChatSummaryRecord[] {
  const conditions = [];
  if (filter.status) conditions.push(eq(chats.status, filter.status));
  if (filter.q && filter.q.trim().length > 0) {
    const needle = `%${filter.q.trim()}%`;
    conditions.push(
      or(
        sql`lower(${chats.title}) like lower(${needle})`,
        sql`lower(${characters.name}) like lower(${needle})`,
      ),
    );
  }
  const rows = db
    .select({ chat: chats, characterName: characters.name, characterAvatar: characters.avatarPath })
    .from(chats)
    .innerJoin(characters, eq(chats.characterId, characters.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(chats.lastMessageAt))
    .all();
  return rows.map((entry) => ({
    ...toChat(entry.chat),
    characterName: entry.characterName,
    characterAvatarPath: entry.characterAvatar,
  }));
}

/**
 * Chat creation inserts the greeting turn (§3.1): role assistant, seq 0,
 * `isGreeting`, its own variant group, populated from `firstMessage` or a
 * random alternate greeting. Whole flow is one transaction.
 */
export function createChat(db: LorekeeperDb, input: CreateChatInput): ChatRow {
  return db.transaction((tx): ChatRow => {
    const character = tx
      .select()
      .from(characters)
      .where(eq(characters.id, input.characterId))
      .all()[0];
    if (!character) {
      throw new ChatRepoError('not_found', `Character ${input.characterId} does not exist`);
    }
    if (input.personaId) {
      const persona = tx.select().from(personas).where(eq(personas.id, input.personaId)).all()[0];
      if (!persona) {
        throw new ChatRepoError('not_found', `Persona ${input.personaId} does not exist`);
      }
    }
    const now = nowIso();
    const chatId = crypto.randomUUID();
    tx.insert(chats)
      .values({
        id: chatId,
        characterId: input.characterId,
        personaId: input.personaId ?? null,
        title: character.name,
        ribbon: null,
        status: 'in_progress',
        providerId: input.providerId ?? null,
        modelId: input.modelId ?? null,
        presetId: input.presetId ?? null,
        lastMessageAt: now,
        lastMessagePreview: greetingPreviewOf(character),
        createdAt: now,
      })
      .run();

    const greetingText =
      character.firstMessage.trim().length > 0
        ? character.firstMessage
        : (pickRandom(character.alternateGreetings.filter((text) => text.trim().length > 0)) ?? '');
    tx.insert(messages)
      .values({
        id: crypto.randomUUID(),
        chatId,
        seq: 0,
        role: 'assistant' as const,
        text: greetingText,
        groupId: crypto.randomUUID(),
        variantIndex: 0,
        isActive: true,
        isGreeting: true,
        providerId: null,
        modelId: null,
        finishReason: null,
        isError: false,
        error: null,
        usage: null,
        createdAt: now,
      })
      .run();
    const chat = tx.select().from(chats).where(eq(chats.id, chatId)).all()[0];
    if (!chat) throw new ChatRepoError('internal_error', 'Chat vanished after insert');
    return chat;
  });
}

function greetingPreviewOf(character: CharacterRow): string | null {
  const text =
    character.firstMessage.trim().length > 0
      ? character.firstMessage
      : (character.alternateGreetings[0] ?? '');
  return text.trim().slice(0, 140) || null;
}

function pickRandom<T>(items: T[]): T | null {
  if (items.length === 0) return null;
  return items[Math.floor(Math.random() * items.length)] ?? null;
}

export interface ChatDetailRecord {
  chat: ChatRow;
  character: CharacterRow;
  persona: PersonaRow | null;
  messages: GroupedMessage[];
}

/** One logical position: all variants of a group + attachments of the active row. */
export interface GroupedMessage {
  id: string;
  seq: number;
  role: 'user' | 'assistant';
  groupId: string | null;
  isGreeting: boolean;
  isError: boolean;
  error: MessageRow['error'];
  variants: Array<{
    id: string;
    variantIndex: number;
    isActive: boolean;
    text: string;
    finishReason: MessageRow['finishReason'];
    isError: boolean;
    error: MessageRow['error'];
    usage: MessageRow['usage'];
    createdAt: string;
  }>;
  activeVariantId: string | null;
  attachments: AttachmentInfo[];
  usage: MessageRow['usage'];
  finishReason: MessageRow['finishReason'];
}

/** Raw attachment row → API shape (`url` derives from the media path, D5). */
export function toAttachmentInfo(row: AttachmentRow): AttachmentInfo {
  const fileName = row.filePath.split(/[\\/]/).pop() ?? row.filePath;
  return {
    id: row.id,
    url: `/media/${fileName}`,
    width: row.width,
    height: row.height,
    mimeType: row.mimeType,
    originalName: row.originalName,
  };
}

export function groupMessages(
  rows: MessageRow[],
  attachmentRows: AttachmentRow[],
): GroupedMessage[] {
  const bySeq = new Map<number, MessageRow[]>();
  for (const row of rows) {
    const bucket = bySeq.get(row.seq);
    if (bucket) bucket.push(row);
    else bySeq.set(row.seq, [row]);
  }
  const grouped: GroupedMessage[] = [];
  for (const bucket of bySeq.values()) {
    const ordered = [...bucket].sort((a, b) => (a.variantIndex ?? 0) - (b.variantIndex ?? 0));
    const head = ordered[0];
    if (!head) continue;
    const active = ordered.find((row) => row.isActive) ?? head;
    const activeAttachments = attachmentRows.filter((a) => a.messageId === active.id);
    grouped.push({
      id: active.id,
      seq: head.seq,
      role: head.role,
      groupId: head.groupId,
      isGreeting: head.isGreeting,
      isError: active.isError,
      error: active.error,
      variants: ordered.map((row) => ({
        id: row.id,
        variantIndex: row.variantIndex ?? 0,
        isActive: row.isActive,
        text: row.text,
        finishReason: row.finishReason,
        isError: row.isError,
        error: row.error,
        usage: row.usage,
        createdAt: row.createdAt,
      })),
      activeVariantId: active.id,
      attachments: activeAttachments.map(toAttachmentInfo),
      usage: active.usage,
      finishReason: active.finishReason,
    });
  }
  return grouped;
}

export function getChatDetail(db: LorekeeperDb, id: string): ChatDetailRecord | null {
  const chat = getChatRow(db, id);
  if (!chat) return null;
  const character = db
    .select()
    .from(characters)
    .where(eq(characters.id, chat.characterId))
    .all()[0];
  if (!character) return null;
  const persona = chat.personaId
    ? (db.select().from(personas).where(eq(personas.id, chat.personaId)).all()[0] ?? null)
    : null;
  const rows = listMessageRows(db, id);
  const attachmentRows = getAttachmentRows(
    db,
    rows.map((row) => row.id),
  );
  return { chat, character, persona, messages: groupMessages(rows, attachmentRows) };
}

export function updateChat(db: LorekeeperDb, id: string, patch: ChatUpdate): ChatRow | null {
  const row = db.update(chats).set(patch).where(eq(chats.id, id)).returning().all()[0];
  return row ?? null;
}

export function deleteChat(db: LorekeeperDb, id: string): boolean {
  const removed = db.delete(chats).where(eq(chats.id, id)).returning().all();
  return removed.length > 0;
}

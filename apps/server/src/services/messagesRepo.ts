import type { ChatError, ProviderId } from '@lorekeeper/shared';
import { and, asc, eq, gt, inArray, sql } from 'drizzle-orm';
import type { LorekeeperDb } from '../db/client';
import { attachments, chats, messages } from '../db/schema';

export type MessageRow = typeof messages.$inferSelect;
export type AttachmentRow = typeof attachments.$inferSelect;
/** The transaction handle passed into `db.transaction(cb)` — query-compatible. */
export type Tx = Parameters<Parameters<LorekeeperDb['transaction']>[0]>[0];

export class MessageRepoError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'MessageRepoError';
    this.code = code;
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

export function listMessageRows(db: LorekeeperDb, chatId: string): MessageRow[] {
  return db
    .select()
    .from(messages)
    .where(eq(messages.chatId, chatId))
    .orderBy(asc(messages.seq), asc(messages.variantIndex))
    .all();
}

export function getMessageRow(
  db: LorekeeperDb,
  chatId: string,
  messageId: string,
): MessageRow | null {
  const rows = db
    .select()
    .from(messages)
    .where(and(eq(messages.chatId, chatId), eq(messages.id, messageId)))
    .all();
  return rows[0] ?? null;
}

export function getAttachmentRows(db: LorekeeperDb, messageIds: string[]): AttachmentRow[] {
  if (messageIds.length === 0) return [];
  return db.select().from(attachments).where(inArray(attachments.messageId, messageIds)).all();
}

function maxSeqIn(tx: Tx, chatId: string): number {
  const rows = tx
    .select({ max: sql<number | null>`max(${messages.seq})` })
    .from(messages)
    .where(eq(messages.chatId, chatId))
    .all();
  return rows[0]?.max ?? -1;
}

export function touchChat(db: Tx, chatId: string, previewText: string | null): void {
  const preview = previewText && previewText.trim().length > 0 ? previewText.slice(0, 140) : null;
  db.update(chats)
    .set({ lastMessageAt: nowIso(), ...(preview !== null ? { lastMessagePreview: preview } : {}) })
    .where(eq(chats.id, chatId))
    .run();
}

/** Renumbers `seq` densely (0..k) after deletions — single transaction (§3.1). */
function renumberSeqsIn(tx: Tx, chatId: string): void {
  const rows = tx
    .select({ seq: messages.seq })
    .from(messages)
    .where(eq(messages.chatId, chatId))
    .groupBy(messages.seq)
    .orderBy(asc(messages.seq))
    .all();
  for (let newSeq = 0; newSeq < rows.length; newSeq += 1) {
    const oldSeq = rows[newSeq]?.seq;
    if (oldSeq === undefined || oldSeq === newSeq) continue;
    tx.update(messages)
      .set({ seq: newSeq })
      .where(and(eq(messages.chatId, chatId), eq(messages.seq, oldSeq)))
      .run();
  }
}

// ---------------------------------------------------------------------------
// Append / variants
// ---------------------------------------------------------------------------

export interface AppendUserMessageResult {
  message: MessageRow;
}

/** Appends a user row at `seq = maxSeq + 1`, linking pending attachments. */
export function appendUserMessage(
  db: LorekeeperDb,
  chatId: string,
  input: { text: string; attachmentIds?: string[] | undefined },
): AppendUserMessageResult {
  const attachmentIds = input.attachmentIds ?? [];
  return db.transaction((tx): AppendUserMessageResult => {
    const seq = maxSeqIn(tx, chatId) + 1;
    const row: MessageRow = {
      id: crypto.randomUUID(),
      chatId,
      seq,
      role: 'user',
      text: input.text,
      groupId: null,
      variantIndex: null,
      isActive: true,
      isGreeting: false,
      providerId: null,
      modelId: null,
      finishReason: null,
      isError: false,
      error: null,
      usage: null,
      createdAt: nowIso(),
    };
    tx.insert(messages).values(row).run();
    if (attachmentIds.length > 0) {
      const pending = tx
        .select()
        .from(attachments)
        .where(inArray(attachments.id, attachmentIds))
        .all();
      const found = new Set(pending.map((attachment) => attachment.id));
      const missing = attachmentIds.filter((id) => !found.has(id));
      const taken = pending.filter((attachment) => attachment.messageId !== null);
      if (missing.length > 0 || taken.length > 0) {
        const details: string[] = [];
        if (missing.length > 0) details.push(`unknown ids: ${missing.join(', ')}`);
        if (taken.length > 0)
          details.push(`already attached: ${taken.map((a) => a.id).join(', ')}`);
        throw new MessageRepoError(
          'invalid_attachment',
          `Attachments could not be linked (${details.join('; ')})`,
        );
      }
      tx.update(attachments)
        .set({ messageId: row.id })
        .where(inArray(attachments.id, attachmentIds))
        .run();
    }
    touchChat(tx, chatId, input.text);
    return { message: row };
  });
}

export interface CreateVariantOptions {
  /** Regenerate targets an existing group; generate opens a fresh one. */
  groupId?: string | undefined;
  providerId?: ProviderId | null | undefined;
  modelId?: string | null | undefined;
  /** Variant cap (globalDefaults.keepLastNVariants, default 20). */
  keepLastNVariants?: number | undefined;
}

/**
 * Creates a new assistant variant. For generate: a fresh group at
 * `seq = maxSeq + 1`. For regenerate: the next variant index inside the
 * target group, immediately active, with the `keepLastNVariants` cap pruned
 * (oldest first; if the pruned variant was active, the next-newest becomes
 * active).
 */
export function createAssistantVariant(
  db: LorekeeperDb,
  chatId: string,
  options: CreateVariantOptions,
): MessageRow {
  return db.transaction((tx): MessageRow => {
    if (options.groupId) {
      const group = tx
        .select()
        .from(messages)
        .where(and(eq(messages.chatId, chatId), eq(messages.groupId, options.groupId)))
        .all();
      if (group.length === 0) {
        throw new MessageRepoError('not_found', 'Variant group does not exist');
      }
      const seq = group[0]?.seq ?? 0;
      const nextIndex = group.reduce((max, row) => Math.max(max, row.variantIndex ?? 0), -1) + 1;
      const row = insertVariant(tx, {
        chatId,
        seq,
        groupId: options.groupId,
        variantIndex: nextIndex,
        providerId: options.providerId ?? null,
        modelId: options.modelId ?? null,
      });
      activateInGroup(tx, row.id, options.groupId);
      pruneGroup(tx, chatId, options.groupId, options.keepLastNVariants ?? 20);
      touchChat(tx, chatId, null);
      return row;
    }
    const seq = maxSeqIn(tx, chatId) + 1;
    const groupId = crypto.randomUUID();
    const row = insertVariant(tx, {
      chatId,
      seq,
      groupId,
      variantIndex: 0,
      providerId: options.providerId ?? null,
      modelId: options.modelId ?? null,
    });
    touchChat(tx, chatId, null);
    return row;
  });
}

interface InsertVariantArgs {
  chatId: string;
  seq: number;
  groupId: string;
  variantIndex: number;
  providerId: ProviderId | null;
  modelId: string | null;
}

function insertVariant(tx: Tx, args: InsertVariantArgs): MessageRow {
  const row: MessageRow = {
    id: crypto.randomUUID(),
    chatId: args.chatId,
    seq: args.seq,
    role: 'assistant',
    text: '',
    groupId: args.groupId,
    variantIndex: args.variantIndex,
    isActive: true,
    isGreeting: false,
    providerId: args.providerId,
    modelId: args.modelId,
    finishReason: null,
    isError: false,
    error: null,
    usage: null,
    createdAt: nowIso(),
  };
  tx.insert(messages).values(row).run();
  return row;
}

/** Activates exactly one variant of a group (swipe — §3.1). */
export function activateVariant(
  db: LorekeeperDb,
  chatId: string,
  groupId: string,
  variantId: string,
): MessageRow {
  return db.transaction((tx): MessageRow => {
    const target = tx
      .select()
      .from(messages)
      .where(
        and(eq(messages.chatId, chatId), eq(messages.groupId, groupId), eq(messages.id, variantId)),
      )
      .all()[0];
    if (!target) {
      throw new MessageRepoError('not_found', 'Variant does not exist in this group');
    }
    activateInGroup(tx, variantId, groupId);
    const updated = tx.select().from(messages).where(eq(messages.id, variantId)).all()[0];
    if (!updated) throw new MessageRepoError('not_found', 'Variant vanished');
    return updated;
  });
}

function activateInGroup(tx: Tx, variantId: string, groupId: string): void {
  tx.update(messages).set({ isActive: false }).where(eq(messages.groupId, groupId)).run();
  tx.update(messages).set({ isActive: true }).where(eq(messages.id, variantId)).run();
}

/** Caps a group at `keepLastN` variants, pruning the oldest (lowest index). */
export function pruneGroup(tx: Tx, chatId: string, groupId: string, keepLastN = 20): void {
  const group = tx
    .select()
    .from(messages)
    .where(and(eq(messages.chatId, chatId), eq(messages.groupId, groupId)))
    .orderBy(asc(messages.variantIndex))
    .all();
  if (group.length <= keepLastN) return;
  const excess = group.slice(0, group.length - keepLastN);
  const excessIds = excess.map((row) => row.id);
  const activePruned = excess.some((row) => row.isActive);
  tx.delete(messages).where(inArray(messages.id, excessIds)).run();
  if (activePruned && keepLastN > 0) {
    const remaining = tx
      .select()
      .from(messages)
      .where(and(eq(messages.chatId, chatId), eq(messages.groupId, groupId)))
      .orderBy(asc(messages.variantIndex))
      .all();
    const nextActive = remaining.at(-1);
    if (nextActive) activateInGroup(tx, nextActive.id, groupId);
  }
}

// ---------------------------------------------------------------------------
// Edit / delete
// ---------------------------------------------------------------------------

export interface EditMessageResult {
  updated: MessageRow;
  truncatedSeq: number | null;
}

/**
 * User message: edit text; `regenerateAfter` deletes every turn at
 * `seq > this.seq` in the same transaction. Assistant message: edits the
 * ACTIVE variant text in place (non-active variants → 409).
 */
export function editMessage(
  db: LorekeeperDb,
  chatId: string,
  messageId: string,
  patch: { text: string; regenerateAfter?: boolean | undefined },
): EditMessageResult {
  return db.transaction((tx): EditMessageResult => {
    const row = tx
      .select()
      .from(messages)
      .where(and(eq(messages.chatId, chatId), eq(messages.id, messageId)))
      .all()[0];
    if (!row) throw new MessageRepoError('not_found', 'Message does not exist');
    if (row.role === 'assistant' && !row.isActive) {
      throw new MessageRepoError('variant_not_active', 'Only the active variant can be edited');
    }
    tx.update(messages).set({ text: patch.text }).where(eq(messages.id, messageId)).run();
    let truncatedSeq: number | null = null;
    if (row.role === 'user' && patch.regenerateAfter) {
      truncatedSeq = row.seq;
      tx.delete(messages)
        .where(and(eq(messages.chatId, chatId), gt(messages.seq, row.seq)))
        .run();
    }
    const latestSeq = maxSeqIn(tx, chatId);
    touchChat(tx, chatId, row.seq >= latestSeq ? patch.text : null);
    const updated = tx.select().from(messages).where(eq(messages.id, messageId)).all()[0];
    if (!updated) throw new MessageRepoError('not_found', 'Message vanished after edit');
    return { updated, truncatedSeq };
  });
}

export interface DeleteMessageResult {
  deletedIds: string[];
}

/**
 * Delete semantics (§3.1):
 * - assistant/error rows: the whole variant group goes, seqs renumber densely.
 * - user rows: `withReplies` removes the user message AND everything after it;
 *   otherwise the reply stays orphaned-but-visible. Both renumber.
 */
export function deleteMessage(
  db: LorekeeperDb,
  chatId: string,
  messageId: string,
  withReplies: boolean,
): DeleteMessageResult {
  return db.transaction((tx): DeleteMessageResult => {
    const row = tx
      .select()
      .from(messages)
      .where(and(eq(messages.chatId, chatId), eq(messages.id, messageId)))
      .all()[0];
    if (!row) throw new MessageRepoError('not_found', 'Message does not exist');

    let deletedIds: string[];
    if (row.role === 'assistant') {
      const group = tx
        .select({ id: messages.id })
        .from(messages)
        .where(and(eq(messages.chatId, chatId), eq(messages.groupId, row.groupId ?? row.id)))
        .all();
      deletedIds = group.map((entry) => entry.id);
      tx.delete(messages).where(inArray(messages.id, deletedIds)).run();
    } else if (withReplies) {
      const victims = tx
        .select({ id: messages.id })
        .from(messages)
        .where(and(eq(messages.chatId, chatId), sql`${messages.seq} >= ${row.seq}`))
        .all();
      deletedIds = victims.map((entry) => entry.id);
      tx.delete(messages).where(inArray(messages.id, deletedIds)).run();
    } else {
      deletedIds = [row.id];
      tx.delete(messages).where(eq(messages.id, row.id)).run();
    }
    renumberSeqsIn(tx, chatId);
    return { deletedIds };
  });
}

/**
 * Persists a streamed variant: final text, finish reason, usage, provenance.
 * Error variants carry the full ChatError payload + partial text (D10).
 */
export function finalizeVariant(
  db: LorekeeperDb,
  messageId: string,
  patch: {
    text: string;
    finishReason: 'stop' | 'length' | 'aborted' | 'error';
    usage?: { promptTokens: number; completionTokens: number; costUsd?: number } | null | undefined;
    isError?: boolean | undefined;
    error?: ChatError | null | undefined;
  },
): MessageRow {
  return db.transaction((tx): MessageRow => {
    tx.update(messages)
      .set({
        text: patch.text,
        finishReason: patch.finishReason,
        ...(patch.usage ? { usage: patch.usage } : {}),
        isError: patch.isError ?? false,
        error: patch.isError ? (patch.error ?? null) : null,
      })
      .where(eq(messages.id, messageId))
      .run();
    const row = tx.select().from(messages).where(eq(messages.id, messageId)).all()[0];
    if (!row) throw new MessageRepoError('not_found', 'Variant vanished during finalize');
    if (patch.text.trim().length > 0) touchChat(tx, row.chatId, patch.text);
    return row;
  });
}

/**
 * Boots cleanup: a server crash mid-stream leaves an empty pending variant
 * (`finishReason IS NULL AND text = ''`) — removed lazily on next load (§5).
 */
export function cleanOrphanedPendingVariants(db: LorekeeperDb, chatId: string): number {
  return db.transaction((tx): number => {
    const pending = tx
      .select({ id: messages.id })
      .from(messages)
      .where(
        and(
          eq(messages.chatId, chatId),
          sql`${messages.finishReason} IS NULL`,
          eq(messages.isGreeting, false),
          eq(messages.text, ''),
        ),
      )
      .all();
    if (pending.length === 0) return 0;
    tx.delete(messages)
      .where(
        inArray(
          messages.id,
          pending.map((entry) => entry.id),
        ),
      )
      .run();
    renumberSeqsIn(tx, chatId);
    return pending.length;
  });
}

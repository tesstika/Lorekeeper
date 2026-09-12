import { readFileSync } from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import type { LorekeeperDb } from '../db/client';
import { attachments } from '../db/schema';
import { fetchOllamaTags, OLLAMA_BASE_URL, ollamaTagsMatch } from '../providers/ollama';
import type { AttachmentRow } from './messagesRepo';
import { getImageCaptioning } from './settingsRepo';

export interface CaptionOutcome {
  attachmentId: string;
  /** The caption text on success; null when captioning failed (non-fatal). */
  caption: string | null;
  /** Descriptive failure reason for prompt warnings; null on success/cache hit. */
  warning: string | null;
}

const VISION_TIMEOUT_MS = 120_000;

/**
 * Extracts Ollama's error message from a failed response. The error body is
 * often a JSON-encoded string containing another JSON envelope — unwrap both
 * layers so users see the real reason (e.g. "model does not support
 * multimodal requests").
 */
async function ollamaErrorDetail(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown } | null;
    let detail = typeof body?.error === 'string' ? body.error : '';
    try {
      const inner = JSON.parse(detail) as { error?: { message?: unknown } };
      if (typeof inner.error?.message === 'string') detail = inner.error.message;
    } catch {
      // detail stays as the raw string
    }
    return detail.length > 0 ? detail : 'no details provided';
  } catch {
    return 'no details provided';
  }
}

/**
 * Local vision helper (feature spec: Moondream2 via Ollama): describes an
 * attached image once, caches the text in `attachments.caption`, and fails
 * gracefully — a captioning failure must never break the generation stream.
 */
export class ImageCaptioner {
  constructor(
    private readonly db: LorekeeperDb,
    private readonly dataDir: string,
  ) {}

  async captionAttachment(attachment: AttachmentRow): Promise<CaptionOutcome> {
    const settings = getImageCaptioning(this.db);
    const model = settings.modelId;

    if (attachment.caption !== null) {
      return { attachmentId: attachment.id, caption: attachment.caption, warning: null };
    }

    // Daemon + model presence check (cheap, descriptive failures).
    try {
      const tags = await fetchOllamaTags();
      const present = tags.some((tag) => ollamaTagsMatch(tag.name, model));
      if (!present) {
        return {
          attachmentId: attachment.id,
          caption: null,
          warning: `The vision model "${model}" is not downloaded — pull it in Settings → Local Image Captioning.`,
        };
      }
    } catch {
      return {
        attachmentId: attachment.id,
        caption: null,
        warning: 'Ollama is not running — the vision helper could not describe the attached image.',
      };
    }

    let base64: string;
    try {
      base64 = readFileSync(path.join(this.dataDir, attachment.filePath)).toString('base64');
    } catch {
      return {
        attachmentId: attachment.id,
        caption: null,
        warning: `Attachment "${attachment.originalName}" could not be read from disk.`,
      };
    }

    try {
      const response = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          prompt: settings.prompt,
          images: [base64],
          stream: false,
        }),
        signal: AbortSignal.timeout(VISION_TIMEOUT_MS),
      });
      if (!response.ok) {
        return {
          attachmentId: attachment.id,
          caption: null,
          warning: `The vision model request failed with HTTP ${response.status}: ${await ollamaErrorDetail(response)}`,
        };
      }
      const body = (await response.json()) as { response?: unknown } | null;
      const caption = typeof body?.response === 'string' ? body.response.trim() : '';
      if (caption.length === 0) {
        return {
          attachmentId: attachment.id,
          caption: null,
          warning: 'The vision model returned an empty description.',
        };
      }
      this.db.update(attachments).set({ caption }).where(eq(attachments.id, attachment.id)).run();
      return { attachmentId: attachment.id, caption, warning: null };
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        return {
          attachmentId: attachment.id,
          caption: null,
          warning: 'The vision model timed out describing the attached image.',
        };
      }
      return {
        attachmentId: attachment.id,
        caption: null,
        warning: `The vision helper failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}

export function createImageCaptioner(db: LorekeeperDb, dataDir: string): ImageCaptioner {
  return new ImageCaptioner(db, dataDir);
}

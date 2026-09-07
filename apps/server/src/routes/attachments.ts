import { attachmentResponseSchema } from '@lorekeeper/shared';
import { attachments } from '../db/schema';
import { sniffImage, storeImage } from '../services/attachments';
import { getComposer } from '../services/settingsRepo';
import type { AppInstance } from '../types/app';
import { httpError } from '../util/http';

/** Hard plugin-side cap (schema max); the configured `composer.imageMaxBytes` is enforced per request. */
const HARD_FILE_LIMIT = 32 * 1024 * 1024;

export async function registerAttachmentRoutes(app: AppInstance): Promise<void> {
  app.post(
    '/api/attachments',
    {
      schema: { response: { 201: attachmentResponseSchema } },
    },
    async (request, reply) => {
      const file = await request.file();
      if (!file) {
        throw httpError(400, 'missing_file', 'Multipart body must contain one image file');
      }

      let buffer: Buffer;
      try {
        buffer = await file.toBuffer();
      } catch {
        throw httpError(
          413,
          'file_too_large',
          `Image exceeds the hard upload limit of ${Math.floor(HARD_FILE_LIMIT / (1024 * 1024))} MB`,
        );
      }

      const limit = getComposer(app.db).imageMaxBytes;
      if (buffer.length > limit) {
        throw httpError(
          413,
          'file_too_large',
          `Image is ${Math.ceil(buffer.length / 1024)} KB; the configured limit is ${Math.ceil(limit / 1024)} KB (Settings → Composer Behavior)`,
        );
      }

      const sniffed = sniffImage(buffer);
      if (!sniffed) {
        throw httpError(
          400,
          'unsupported_media_type',
          'Only PNG, JPEG, WEBP or GIF images are accepted (checked via magic bytes, not the declared type)',
        );
      }

      const stored = storeImage(app.dataDir, buffer, sniffed);
      const row = app.db
        .insert(attachments)
        .values({
          id: crypto.randomUUID(),
          messageId: null,
          filePath: stored.filePath,
          originalName: file.filename || 'image',
          mimeType: sniffed.mimeType,
          width: sniffed.width,
          height: sniffed.height,
          sizeBytes: stored.sizeBytes,
          createdAt: new Date().toISOString(),
        })
        .returning()
        .all()[0];
      if (!row) throw new Error('Attachment insert returned no row');

      return reply.code(201).send({
        id: row.id,
        url: stored.url,
        width: row.width,
        height: row.height,
        mimeType: row.mimeType,
        sizeBytes: row.sizeBytes,
        originalName: row.originalName,
      });
    },
  );
}

import type { SseEvent } from '@lorekeeper/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * Transport seam for the generation session: the Fastify route wires this to
 * `reply.raw` (hijacked lifecycle, plan §2.2/D1); tests drive it with fakes.
 */
export interface SseWriter {
  writeEvent(event: SseEvent): void;
  writeComment(comment: string): void;
  end(): void;
  /** Fires when the client connection drops mid-stream (Stop button / tab close). */
  onClientClose(handler: () => void): void;
  isClosed(): boolean;
}

export function createSseWriter(request: FastifyRequest, reply: FastifyReply): SseWriter {
  // Take over the raw response: Fastify skips serialization/hooks from here on.
  reply.hijack();
  const raw = reply.raw;
  raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  let closed = false;
  const closeHandlers: Array<() => void> = [];
  request.raw.on('close', () => {
    if (closed) return;
    // 'close' also fires after a normal end(); the session marks itself done
    // and ignores the callback via isClosed() before that matters.
    closed = true;
    for (const handler of closeHandlers) handler();
  });

  return {
    writeEvent(event: SseEvent): void {
      if (closed || raw.writableEnded || raw.destroyed) return;
      try {
        raw.write(`data: ${JSON.stringify(event)}\n\n`);
      } catch {
        closed = true;
      }
    },
    writeComment(comment: string): void {
      if (closed || raw.writableEnded || raw.destroyed) return;
      try {
        raw.write(`: ${comment}\n\n`);
      } catch {
        closed = true;
      }
    },
    end(): void {
      if (closed || raw.writableEnded || raw.destroyed) return;
      closed = true;
      try {
        raw.end();
      } catch {
        // socket already gone
      }
    },
    onClientClose(handler: () => void): void {
      if (closed) {
        handler();
        return;
      }
      closeHandlers.push(handler);
    },
    isClosed(): boolean {
      return closed || raw.writableEnded || raw.destroyed;
    },
  };
}

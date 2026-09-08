import type { SseEvent } from '@lorekeeper/shared';
import type { FastifyReply } from 'fastify';

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

export function createSseWriter(reply: FastifyReply): SseWriter {
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
  // Client-disconnect signal: the RESPONSE stream's 'close' fires when the TCP
  // connection drops mid-stream (Stop button / tab close) and after a normal
  // end() — the session marks itself done first, so the latter is a no-op via
  // the closed flag. `request.raw.on('close')` is NOT usable here: since
  // Node 16 (carried into Bun) IncomingMessage 'close' also fires when a
  // request body is merely consumed, which falsely aborts any generation
  // POSTed with a body after its first delta.
  raw.on('close', () => {
    if (closed) return;
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

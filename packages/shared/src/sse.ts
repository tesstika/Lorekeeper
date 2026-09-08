// ---------------------------------------------------------------------------
// Shared SSE frame parser (plan §7.2) — used by the frontend streaming client
// (fetch + ReadableStream). The server side keeps its own provider-facing
// parser in apps/server/src/providers/openaiCompat.ts.
//
// Handles: `data:` payload lines, `event:` labels, `:` comment lines
// (heartbeats), multi-line data, CRLF endings and chunk splits at arbitrary
// byte boundaries (including multi-byte UTF-8 sequences via TextDecoder).
// ---------------------------------------------------------------------------

export interface SseFrame {
  event: string | null;
  data: string;
}

function parseEventBlock(block: string): SseFrame | null {
  let event: string | null = null;
  const dataLines: string[] = [];
  for (const rawLine of block.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (line.startsWith(':')) continue; // comment / heartbeat
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).replace(/^ /, ''));
    } else if (line.startsWith('event:')) {
      event = line.slice(6).trim();
    }
  }
  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join('\n') };
}

/** Parses an SSE byte stream into frames. Blank lines delimit events. */
export async function* parseSseFrames(
  source: AsyncIterable<Uint8Array>,
): AsyncGenerator<SseFrame, void, undefined> {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of source) {
    buffer += decoder.decode(chunk, { stream: true });
    let boundary = buffer.indexOf('\n\n');
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const frame = parseEventBlock(block);
      if (frame) yield frame;
      boundary = buffer.indexOf('\n\n');
    }
  }
  // Flush a trailing event that lacks its terminating blank line.
  const tail = buffer.trim();
  if (tail.length > 0) {
    const frame = parseEventBlock(tail);
    if (frame) yield frame;
  }
}

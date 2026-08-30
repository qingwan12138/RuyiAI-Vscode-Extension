export async function* parseServerSentEvents(
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal
): AsyncIterable<string> {
  signal?.throwIfAborted();
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let dataLines: string[] = [];

  const consumeLine = (line: string): string | undefined => {
    if (line === '') {
      if (dataLines.length === 0) return undefined;
      const event = dataLines.join('\n');
      dataLines = [];
      return event;
    }
    if (line.startsWith(':')) return undefined;
    if (line === 'data') dataLines.push('');
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
    return undefined;
  };

  try {
    while (true) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        let line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (line.endsWith('\r')) line = line.slice(0, -1);
        const event = consumeLine(line);
        if (event !== undefined) yield event;
        newline = buffer.indexOf('\n');
      }
      if (done) break;
    }
    if (buffer.endsWith('\r')) buffer = buffer.slice(0, -1);
    if (buffer) {
      const event = consumeLine(buffer);
      if (event !== undefined) yield event;
    }
    if (dataLines.length > 0) yield dataLines.join('\n');
  } finally {
    reader.releaseLock();
  }
}

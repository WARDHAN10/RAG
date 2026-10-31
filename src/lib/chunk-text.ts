export type TextChunk = {
  index: number;
  text: string;
};

export function chunkText(
  input: string,
  chunkSize = 900,
  overlap = 120,
): TextChunk[] {
  const text = input.replace(/\r\n/g, "\n").trim();

  if (!text) return [];
  if (chunkSize < 1 || overlap < 0 || overlap >= chunkSize) {
    throw new Error("Chunk size must be positive and overlap must be smaller than the chunk size.");
  }

  const chunks: TextChunk[] = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(start + chunkSize, text.length);

    if (end < text.length) {
      const boundary = text.lastIndexOf(" ", end);
      if (boundary > start + Math.floor(chunkSize * 0.65)) {
        end = boundary;
      }
    }

    const content = text.slice(start, end).trim();
    if (content) chunks.push({ index: chunks.length + 1, text: content });
    if (end >= text.length) break;

    start = Math.max(end - overlap, start + 1);
    while (start < text.length && /\s/.test(text[start])) start += 1;
  }

  return chunks;
}

export interface ChunkOptions {
  maxChars: number;
  overlapChars: number;
}

export interface TextChunk {
  position: number;
  content: string;
}

/**
 * Paragraph-aware sliding-window chunker.
 *
 * Why this shape (see README "Chunking" for the full rationale):
 *
 *  - Split on blank lines first. A paragraph is the smallest unit that is
 *    usually self-contained, so packing whole paragraphs keeps a retrieved
 *    chunk readable as a citation rather than starting mid-thought.
 *  - Pack paragraphs up to `maxChars` instead of emitting one chunk per
 *    paragraph. One-line paragraphs would otherwise produce tiny vectors whose
 *    cosine scores are dominated by a couple of terms.
 *  - Fall back to sentence splitting, then to a hard character cut, for input
 *    that has no paragraph or sentence structure (minified text, transcripts).
 *  - Carry `overlapChars` of the previous chunk into the next so a fact that
 *    straddles a boundary is fully present in at least one chunk.
 *
 * Character counts rather than tokens: it is a ~4x approximation of tokens for
 * English, needs no tokenizer dependency, and the chunk size is a tuning knob
 * anyway. A token-exact splitter would matter if we were packing a context
 * window to the limit; we are not.
 */
export function chunkText(text: string, options: ChunkOptions): TextChunk[] {
  const normalised = normaliseWhitespace(text);
  if (normalised.length === 0) return [];

  const { maxChars, overlapChars } = options;
  if (overlapChars >= maxChars) {
    throw new Error(`overlapChars (${overlapChars}) must be smaller than maxChars (${maxChars})`);
  }

  const segments = splitIntoSegments(normalised, maxChars);
  const chunks: string[] = [];
  let buffer = '';

  for (const segment of segments) {
    if (buffer.length === 0) {
      buffer = segment;
      continue;
    }
    if (buffer.length + segment.length + 2 <= maxChars) {
      buffer = `${buffer}\n\n${segment}`;
      continue;
    }
    chunks.push(buffer);
    buffer = overlapChars > 0 ? `${tailOf(buffer, overlapChars)}\n\n${segment}` : segment;

    // The overlap prefix can push an already-large segment past the cap.
    while (buffer.length > maxChars) {
      chunks.push(buffer.slice(0, maxChars));
      buffer = buffer.slice(maxChars - overlapChars);
    }
  }

  if (buffer.trim().length > 0) chunks.push(buffer);

  return chunks
    .map((content) => content.trim())
    .filter((content) => content.length > 0)
    .map((content, position) => ({ position, content }));
}

/** Paragraphs, then sentences, then hard cuts - whatever fits under maxChars. */
function splitIntoSegments(text: string, maxChars: number): string[] {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const segments: string[] = [];
  for (const paragraph of paragraphs) {
    if (paragraph.length <= maxChars) {
      segments.push(paragraph);
      continue;
    }
    for (const sentenceGroup of packSentences(paragraph, maxChars)) segments.push(sentenceGroup);
  }
  return segments;
}

function packSentences(paragraph: string, maxChars: number): string[] {
  // Split after ., !, ? or a newline when followed by whitespace. Deliberately
  // simple: a full sentence tokenizer is not worth the dependency here, and a
  // mis-split only shifts a boundary by a few words.
  const sentences = paragraph.split(/(?<=[.!?])\s+|\n+/).filter(Boolean);
  const packed: string[] = [];
  let buffer = '';

  for (const sentence of sentences) {
    if (sentence.length > maxChars) {
      if (buffer) {
        packed.push(buffer);
        buffer = '';
      }
      for (let i = 0; i < sentence.length; i += maxChars) packed.push(sentence.slice(i, i + maxChars));
      continue;
    }
    if (buffer.length + sentence.length + 1 <= maxChars) {
      buffer = buffer ? `${buffer} ${sentence}` : sentence;
    } else {
      if (buffer) packed.push(buffer);
      buffer = sentence;
    }
  }
  if (buffer) packed.push(buffer);
  return packed;
}

/** Last `size` characters, snapped forward to a word boundary. */
function tailOf(text: string, size: number): string {
  if (text.length <= size) return text;
  const tail = text.slice(-size);
  const boundary = tail.search(/\s/);
  return boundary === -1 ? tail : tail.slice(boundary + 1);
}

function normaliseWhitespace(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

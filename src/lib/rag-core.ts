import { createHash } from "node:crypto";

export const DEFAULT_TOP_K = 5;
export const MAX_TOP_K = 8;
export const MAX_QUESTION_CHARACTERS = 2000;
export const MAX_EVIDENCE_CHARACTERS = 10_000;

export class AskInputError extends Error {}
export class MalformedModelAnswerError extends Error {}

export type AskInput = {
  question: string;
  topK: number;
};

export type RetrievedSource = {
  citationId: string;
  chunkId: string;
  pointId: string;
  documentId: string;
  documentName: string;
  chunkIndex: number | null;
  rank: number;
  score: number | null;
  text: string;
};

export type NormalizedModelAnswer = {
  answer: string;
  citations: string[];
  abstained: boolean;
};

export type QueryMetrics = {
  collectionCheckMs: number | null;
  queryEmbeddingMs: number | null;
  vectorRetrievalMs: number | null;
  totalRetrievalMs: number | null;
  answerGenerationMs: number | null;
  totalMs: number;
  chunksRetrieved: number;
  queryEmbeddingTokens: number | null;
  answerInputTokens: number | null;
  answerCachedInputTokens: number | null;
  answerOutputTokens: number | null;
  estimatedQueryCostUsd: number | null;
  answerModel: string | null;
};

export type RagStatus = "empty" | "no-results" | "answered" | "insufficient-evidence";

export type RagResponse = {
  status: RagStatus;
  answer: string;
  abstained: boolean;
  citations: string[];
  sources: RetrievedSource[];
  metrics: QueryMetrics;
};

export function validateAskInput(value: unknown): AskInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AskInputError("Request must be a JSON object.");
  }

  const body = value as Record<string, unknown>;
  if (typeof body.question !== "string") {
    throw new AskInputError("Enter a question to search your documents.");
  }

  const question = body.question.trim();
  if (!question) throw new AskInputError("Enter a question to search your documents.");
  if (question.length > MAX_QUESTION_CHARACTERS) {
    throw new AskInputError(`Questions must be ${MAX_QUESTION_CHARACTERS} characters or fewer.`);
  }

  const topK = body.topK === undefined ? DEFAULT_TOP_K : body.topK;
  if (typeof topK !== "number" || !Number.isInteger(topK) || topK < 1 || topK > MAX_TOP_K) {
    throw new AskInputError(`topK must be a whole number between 1 and ${MAX_TOP_K}.`);
  }

  return { question, topK };
}

export function createChunkId(documentName: string, chunkIndex: number | null, text: string) {
  const normalizedName = documentName.replace(/\\/g, "/").split("/").pop()?.trim() || "document";
  const index = chunkIndex === null ? "unknown" : String(chunkIndex);
  const textHash = createHash("sha256").update(text).digest("hex").slice(0, 12);
  return `${normalizedName}#chunk-${index}-${textHash}`;
}

export function mapRetrievedPoints(points: readonly unknown[]): RetrievedSource[] {
  const sources: RetrievedSource[] = [];

  points.forEach((value, index) => {
    if (!value || typeof value !== "object") return;
    const point = value as Record<string, unknown>;
    const payload = point.payload;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return;

    const data = payload as Record<string, unknown>;
    const pointId = point.id;
    if (
      (typeof pointId !== "string" && typeof pointId !== "number") ||
      typeof data.documentId !== "string" ||
      typeof data.name !== "string" ||
      typeof data.chunkText !== "string"
    ) {
      return;
    }

    const documentName = data.name;
    const chunkIndex = typeof data.chunkIndex === "number" ? data.chunkIndex : null;
    const text = data.chunkText;
    sources.push({
      citationId: `S${sources.length + 1}`,
      chunkId: typeof data.chunkId === "string"
        ? data.chunkId
        : createChunkId(documentName, chunkIndex, text),
      pointId: String(pointId),
      documentId: data.documentId,
      documentName,
      chunkIndex,
      rank: index + 1,
      score: typeof point.score === "number" ? point.score : null,
      text,
    });
  });

  return sources;
}

export function buildEvidenceContext(sources: readonly RetrievedSource[]) {
  let remainingCharacters = MAX_EVIDENCE_CHARACTERS;
  return sources.map((source) => {
    const text = source.text.slice(0, remainingCharacters);
    remainingCharacters = Math.max(0, remainingCharacters - text.length);
    return {
      sourceId: source.citationId,
      documentName: source.documentName,
      chunkIndex: source.chunkIndex,
      text,
    };
  });
}

export function normalizeModelAnswer(
  value: unknown,
  sources: readonly RetrievedSource[],
): NormalizedModelAnswer {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MalformedModelAnswerError("The answer model returned an invalid response.");
  }

  const result = value as Record<string, unknown>;
  if (
    typeof result.answer !== "string" ||
    !result.answer.trim() ||
    typeof result.abstained !== "boolean" ||
    !Array.isArray(result.citations) ||
    !result.citations.every((citation) => typeof citation === "string")
  ) {
    throw new MalformedModelAnswerError("The answer model returned an invalid response.");
  }

  if (result.abstained) {
    return {
      answer: "The available documents do not contain enough information to answer.",
      citations: [],
      abstained: true,
    };
  }

  const allowedCitations = new Set(sources.map((source) => source.citationId));
  const validCitations = new Set(
    result.citations.filter(
      (citation): citation is string => allowedCitations.has(citation),
    ),
  );
  for (const match of result.answer.matchAll(/\[(S\d+)\]/g)) {
    if (allowedCitations.has(match[1])) validCitations.add(match[1]);
  }

  if (validCitations.size === 0) {
    return {
      answer: "The available documents do not contain enough information to answer.",
      citations: [],
      abstained: true,
    };
  }

  let answer = result.answer.replace(/\[(S\d+)\]/g, (marker, citationId: string) =>
    allowedCitations.has(citationId) ? marker : "",
  ).trim();
  const citations = [...validCitations];
  if (!/\[S\d+\]/.test(answer)) {
    answer += `\n\nSources: ${citations.map((citation) => `[${citation}]`).join(" ")}`;
  }

  return { answer, citations, abstained: false };
}

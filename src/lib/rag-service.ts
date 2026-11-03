import { estimateEmbeddingQueryCost, estimateFullQueryCost } from "./query-cost";
import { getRagMode, getVectorSize } from "./rag-config";
import {
  mapRetrievedPoints,
  normalizeModelAnswer,
  type AskInput,
  type QueryMetrics,
  type RagResponse,
  type RetrievedSource,
} from "./rag-core";

export class RagPipelineError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export type RagDependencies = {
  collectionExists(): Promise<boolean>;
  embedQuery(question: string): Promise<{ vector: number[]; promptTokens: number | null }>;
  search(vector: number[], topK: number): Promise<readonly unknown[]>;
  generateAnswer(question: string, sources: readonly RetrievedSource[]): Promise<{
    output: unknown;
    model: string;
    inputTokens: number | null;
    cachedInputTokens: number | null;
    outputTokens: number | null;
  }>;
  now?: () => number;
};

function elapsed(start: number, now: () => number) {
  return Math.max(0, Math.round((now() - start) * 10) / 10);
}

function createMetrics(
  values: Partial<QueryMetrics> & Pick<QueryMetrics, "totalMs">,
): QueryMetrics {
  return {
    collectionCheckMs: null,
    queryEmbeddingMs: null,
    vectorRetrievalMs: null,
    totalRetrievalMs: null,
    answerGenerationMs: null,
    chunksRetrieved: 0,
    queryEmbeddingTokens: null,
    answerInputTokens: null,
    answerCachedInputTokens: null,
    answerOutputTokens: null,
    estimatedQueryCostUsd: null,
    answerModel: null,
    ...values,
    totalMs: values.totalMs,
  };
}

function noEvidenceResponse(
  status: "empty" | "no-results",
  answer: string,
  metrics: QueryMetrics,
): RagResponse {
  return {
    status,
    answer,
    abstained: true,
    citations: [],
    sources: [],
    metrics,
  };
}

export async function runBasicRag(
  input: AskInput,
  dependencies: RagDependencies,
  requestStartedAt?: number,
): Promise<RagResponse> {
  const now = dependencies.now ?? (() => performance.now());
  const startedAt = requestStartedAt ?? now();
  const retrievalStartedAt = now();
  let collectionExists: boolean;

  try {
    collectionExists = await dependencies.collectionExists();
  } catch {
    throw new RagPipelineError(
      "Could not connect to Qdrant. Check the vector database and try again.",
      503,
    );
  }

  const collectionCheckMs = elapsed(retrievalStartedAt, now);
  if (!collectionExists) {
    return noEvidenceResponse(
      "empty",
      "No documents have been indexed yet. Upload a document before asking a question.",
      createMetrics({
        collectionCheckMs,
        totalMs: elapsed(startedAt, now),
        estimatedQueryCostUsd: 0,
      }),
    );
  }

  let embedding: { vector: number[]; promptTokens: number | null };
  const embeddingStartedAt = now();
  try {
    embedding = await dependencies.embedQuery(input.question);
  } catch {
    throw new RagPipelineError(
      getRagMode() === "offline"
        ? "Could not embed the question. Check Ollama and the configured embedding model."
        : "Could not embed the question. Check the OpenAI API key and retry.",
      502,
    );
  }
  const queryEmbeddingMs = elapsed(embeddingStartedAt, now);
  if (embedding.vector.length !== getVectorSize() || embedding.vector.some((value) => !Number.isFinite(value))) {
    throw new RagPipelineError("The embedding provider returned an invalid query vector.", 502);
  }

  let rawPoints: readonly unknown[];
  const vectorSearchStartedAt = now();
  try {
    rawPoints = await dependencies.search(embedding.vector, input.topK);
  } catch {
    throw new RagPipelineError("Could not search Qdrant. Check the database and retry.", 503);
  }
  const vectorRetrievalMs = elapsed(vectorSearchStartedAt, now);
  const sources = mapRetrievedPoints(rawPoints);

  if (sources.length === 0) {
    return noEvidenceResponse(
      "no-results",
      "I could not find readable passages for that question in the indexed documents.",
      createMetrics({
        collectionCheckMs,
        queryEmbeddingMs,
        vectorRetrievalMs,
        totalRetrievalMs: queryEmbeddingMs + vectorRetrievalMs,
        totalMs: elapsed(startedAt, now),
        queryEmbeddingTokens: embedding.promptTokens,
        estimatedQueryCostUsd:
          getRagMode() === "offline" ? 0 : estimateEmbeddingQueryCost(embedding.promptTokens),
      }),
    );
  }

  const answerStartedAt = now();
  let generated: Awaited<ReturnType<RagDependencies["generateAnswer"]>>;
  try {
    generated = await dependencies.generateAnswer(input.question, sources);
  } catch {
    throw new RagPipelineError(
      getRagMode() === "offline"
        ? "Could not generate an answer. Check Ollama and the configured chat model."
        : "Could not generate an answer. Check the OpenAI model configuration and retry.",
      502,
    );
  }
  const answerGenerationMs = elapsed(answerStartedAt, now);

  let normalized;
  try {
    normalized = normalizeModelAnswer(generated.output, sources);
  } catch {
    throw new RagPipelineError("The answer model returned an invalid response. Please try again.", 502);
  }

  const metrics = createMetrics({
    collectionCheckMs,
    queryEmbeddingMs,
    vectorRetrievalMs,
    totalRetrievalMs: queryEmbeddingMs + vectorRetrievalMs,
    answerGenerationMs,
    totalMs: elapsed(startedAt, now),
    chunksRetrieved: sources.length,
    queryEmbeddingTokens: embedding.promptTokens,
    answerInputTokens: generated.inputTokens,
    answerCachedInputTokens: generated.cachedInputTokens,
    answerOutputTokens: generated.outputTokens,
    estimatedQueryCostUsd: getRagMode() === "offline"
      ? 0
      : estimateFullQueryCost({
          model: generated.model,
          embeddingTokens: embedding.promptTokens,
          answerInputTokens: generated.inputTokens,
          answerCachedInputTokens: generated.cachedInputTokens,
          answerOutputTokens: generated.outputTokens,
        }),
    answerModel: generated.model,
  });

  return {
    status: normalized.abstained ? "insufficient-evidence" : "answered",
    answer: normalized.answer,
    abstained: normalized.abstained,
    citations: normalized.citations,
    sources,
    metrics,
  };
}

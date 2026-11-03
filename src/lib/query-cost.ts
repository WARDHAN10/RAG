import {
  CHAT_MODEL_PRICING,
  EMBEDDING_USD_PER_MILLION_TOKENS,
} from "./openai-pricing";

export function estimateEmbeddingQueryCost(tokens: number | null) {
  if (tokens === null || !Number.isFinite(tokens) || tokens < 0) return null;
  return (tokens / 1_000_000) * EMBEDDING_USD_PER_MILLION_TOKENS;
}

export function estimateFullQueryCost(input: {
  model: string;
  embeddingTokens: number | null;
  answerInputTokens: number | null;
  answerCachedInputTokens: number | null;
  answerOutputTokens: number | null;
}) {
  const pricing = CHAT_MODEL_PRICING[input.model];
  if (
    !pricing ||
    input.embeddingTokens === null ||
    input.answerInputTokens === null ||
    input.answerOutputTokens === null ||
    !Number.isFinite(input.embeddingTokens) ||
    !Number.isFinite(input.answerInputTokens) ||
    !Number.isFinite(input.answerOutputTokens)
  ) {
    return null;
  }

  const cachedInputTokens = Math.min(
    input.answerInputTokens,
    Math.max(0, input.answerCachedInputTokens ?? 0),
  );
  const uncachedInputTokens = input.answerInputTokens - cachedInputTokens;
  return (
    (input.embeddingTokens / 1_000_000) * EMBEDDING_USD_PER_MILLION_TOKENS +
    (uncachedInputTokens / 1_000_000) * pricing.inputUsdPerMillion +
    (cachedInputTokens / 1_000_000) * pricing.cachedInputUsdPerMillion +
    (input.answerOutputTokens / 1_000_000) * pricing.outputUsdPerMillion
  );
}

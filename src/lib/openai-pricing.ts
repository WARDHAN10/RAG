export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_USD_PER_MILLION_TOKENS = 0.02;

export const DEFAULT_CHAT_MODEL = "gpt-5.4-mini";

export const CHAT_MODEL_PRICING: Record<
  string,
  { inputUsdPerMillion: number; cachedInputUsdPerMillion: number; outputUsdPerMillion: number }
> = {
  "gpt-5.4-mini": {
    inputUsdPerMillion: 0.75,
    cachedInputUsdPerMillion: 0.075,
    outputUsdPerMillion: 4.5,
  },
  "gpt-5.4-mini-2026-03-17": {
    inputUsdPerMillion: 0.75,
    cachedInputUsdPerMillion: 0.075,
    outputUsdPerMillion: 4.5,
  },
};

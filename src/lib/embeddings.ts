import { getOpenAIClient, isOpenAIConfigured } from "@/lib/openai-client";
import { getEmbeddingModel, getRagMode, getVectorSize, isRagProviderConfigured } from "@/lib/rag-config";
import { postOllamaJson } from "@/lib/ollama-client";

const ONLINE_BATCH_SIZE = 128;
const OFFLINE_BATCH_SIZE = 16;

export const isEmbeddingConfigured = isRagProviderConfigured;

type OllamaEmbedResponse = {
  embeddings?: unknown;
  prompt_eval_count?: unknown;
};

function validateVectors(vectors: number[][], expectedCount: number) {
  const dimensions = getVectorSize();
  if (
    vectors.length !== expectedCount ||
    vectors.some((vector) =>
      vector.length !== dimensions || vector.some((value) => !Number.isFinite(value)),
    )
  ) {
    throw new Error("The embedding provider returned vectors with an unexpected shape.");
  }
  return vectors;
}

export async function embedTexts(texts: string[]) {
  if (texts.length === 0) return { vectors: [], promptTokens: 0 };

  const offline = getRagMode() === "offline";
  if (!offline && !isOpenAIConfigured()) throw new Error("OPENAI_API_KEY is not configured.");
  const model = getEmbeddingModel();
  const batchSize = offline ? OFFLINE_BATCH_SIZE : ONLINE_BATCH_SIZE;
  const vectors: number[][] = [];
  let promptTokens = 0;

  for (let start = 0; start < texts.length; start += batchSize) {
    const batch = texts.slice(start, start + batchSize);
    if (offline) {
      const response = await postOllamaJson<OllamaEmbedResponse>("/api/embed", {
        model,
        input: batch,
      });
      if (!Array.isArray(response.embeddings)) {
        throw new Error("Ollama returned no embeddings.");
      }
      const batchVectors = response.embeddings.filter(
        (vector): vector is number[] =>
          Array.isArray(vector) && vector.every((value) => typeof value === "number" && Number.isFinite(value)),
      );
      if (batchVectors.length !== batch.length) {
        throw new Error("Ollama returned an unexpected number of embeddings.");
      }
      vectors.push(...batchVectors);
      if (typeof response.prompt_eval_count === "number" && Number.isFinite(response.prompt_eval_count)) {
        promptTokens += response.prompt_eval_count;
      }
    } else {
      const response = await getOpenAIClient().embeddings.create({
        model,
        input: batch,
        dimensions: getVectorSize(),
      });
      promptTokens += response.usage?.prompt_tokens ?? 0;
      const ordered = [...response.data].sort((left, right) => left.index - right.index);
      if (ordered.length !== batch.length) {
        throw new Error("The embeddings provider returned an unexpected result.");
      }
      vectors.push(...ordered.map((item) => item.embedding));
    }
  }

  return { vectors: validateVectors(vectors, texts.length), promptTokens };
}

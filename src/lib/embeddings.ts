import OpenAI from "openai";
import { VECTOR_SIZE } from "@/lib/qdrant";

const BATCH_SIZE = 128;

let client: OpenAI | undefined;

export function isEmbeddingConfigured() {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  if (!client) client = new OpenAI({ apiKey });
  return client;
}

export async function embedTexts(texts: string[]) {
  if (texts.length === 0) return { vectors: [], promptTokens: 0 };

  const openai = getOpenAIClient();
  const vectors: number[][] = [];
  let promptTokens = 0;

  for (let start = 0; start < texts.length; start += BATCH_SIZE) {
    const batch = texts.slice(start, start + BATCH_SIZE);
    const response = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: batch,
      dimensions: VECTOR_SIZE,
    });

    promptTokens += response.usage?.prompt_tokens ?? 0;
    const ordered = [...response.data].sort((left, right) => left.index - right.index);
    if (ordered.length !== batch.length) {
      throw new Error("The embeddings provider returned an unexpected result.");
    }

    vectors.push(...ordered.map((item) => item.embedding));
  }

  return { vectors, promptTokens };
}

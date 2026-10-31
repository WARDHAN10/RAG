import { QdrantClient } from "@qdrant/js-client-rest";

export const VECTOR_SIZE = 1536;

let client: QdrantClient | undefined;

export function isQdrantConfigured() {
  return Boolean(process.env.QDRANT_URL?.trim());
}

export function getCollectionName() {
  return process.env.QDRANT_COLLECTION?.trim() || "quiznest_documents";
}

export function getQdrantClient() {
  const url = process.env.QDRANT_URL?.trim();
  if (!url) {
    throw new Error("QDRANT_URL is not configured.");
  }

  if (!client) {
    const apiKey = process.env.QDRANT_API_KEY?.trim();
    client = new QdrantClient({
      url,
      ...(apiKey ? { apiKey } : {}),
    });
  }

  return client;
}

export async function collectionExists() {
  const result = await getQdrantClient().getCollections();
  return result.collections.some((collection) => collection.name === getCollectionName());
}

export async function ensureCollection() {
  if (await collectionExists()) return;

  await getQdrantClient().createCollection(getCollectionName(), {
    vectors: {
      size: VECTOR_SIZE,
      distance: "Cosine",
    },
  });
}

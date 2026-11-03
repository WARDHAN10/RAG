import { QdrantClient } from "@qdrant/js-client-rest";
import { getVectorSize } from "./rag-config";

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

export async function getCollectionVectorSize() {
  const collection = await getQdrantClient().getCollection(getCollectionName());
  const vectors = collection.config.params.vectors as unknown;
  if (!vectors || typeof vectors !== "object" || !("size" in vectors)) return null;
  return typeof vectors.size === "number" ? vectors.size : null;
}

export async function ensureCollection() {
  const expectedSize = getVectorSize();
  if (await collectionExists()) {
    const currentSize = await getCollectionVectorSize();
    if (currentSize !== expectedSize) {
      throw new Error("Qdrant collection dimensions do not match the selected embedding model. Reset the index before re-uploading.");
    }
    return;
  }

  await getQdrantClient().createCollection(getCollectionName(), {
    vectors: {
      size: expectedSize,
      distance: "Cosine",
    },
  });
}

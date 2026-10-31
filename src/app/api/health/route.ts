import { isEmbeddingConfigured } from "@/lib/embeddings";
import { getQdrantClient, isQdrantConfigured } from "@/lib/qdrant";

export async function GET() {
  const qdrantConfigured = isQdrantConfigured();
  const embeddingConfigured = isEmbeddingConfigured();
  let qdrantConnected = false;

  if (qdrantConfigured) {
    try {
      await getQdrantClient().getCollections();
      qdrantConnected = true;
    } catch {
      qdrantConnected = false;
    }
  }

  return Response.json(
    {
      qdrantConfigured,
      qdrantConnected,
      embeddingConfigured,
      ready: qdrantConnected && embeddingConfigured,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

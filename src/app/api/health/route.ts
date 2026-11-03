import { connection } from "next/server";
import { collectionExists, getCollectionVectorSize, getQdrantClient, isQdrantConfigured } from "@/lib/qdrant";
import { getRagProviderHealth } from "@/lib/rag-config";

export async function GET() {
  await connection();
  const qdrantConfigured = isQdrantConfigured();
  const provider = await getRagProviderHealth();
  const embeddingConfigured = provider.providerReady;
  let qdrantConnected = false;
  let indexedVectorSize: number | null = null;
  let vectorDimensionsMatch: boolean | null = null;
  let indexMessage: string | null = null;

  if (qdrantConfigured) {
    try {
      await getQdrantClient().getCollections();
      qdrantConnected = true;
      if (await collectionExists()) {
        indexedVectorSize = await getCollectionVectorSize();
        vectorDimensionsMatch = indexedVectorSize === provider.vectorSize;
        if (!vectorDimensionsMatch) {
          indexMessage = "The Qdrant collection uses a different vector size. Click Reset index, then re-upload this dataset.";
        }
      }
    } catch {
      qdrantConnected = false;
      vectorDimensionsMatch = null;
    }
  }

  return Response.json(
    {
      qdrantConfigured,
      qdrantConnected,
      embeddingConfigured,
      ragMode: provider.mode,
      modeConfigured: provider.modeConfigured,
      providerName: provider.providerName,
      embeddingModel: provider.embeddingModel,
      answerModel: provider.answerModel,
      vectorSize: provider.vectorSize,
      indexedVectorSize,
      vectorDimensionsMatch,
      indexMessage,
      providerConnected: provider.providerConnected,
      providerMessage: provider.providerMessage,
      ready: qdrantConnected && embeddingConfigured && vectorDimensionsMatch !== false,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

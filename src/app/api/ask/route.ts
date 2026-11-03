import { handleAskRequest } from "@/lib/ask-handler";
import { embedTexts } from "@/lib/embeddings";
import { generateGroundedAnswer } from "@/lib/generation";
import {
  collectionExists,
  getCollectionName,
  getQdrantClient,
  isQdrantConfigured,
} from "@/lib/qdrant";
import { getRagProviderConfigurationMessage, isRagProviderConfigured } from "@/lib/rag-config";
import type { RagDependencies } from "@/lib/rag-service";

function serviceUnavailable(message: string) {
  return Response.json({ error: message }, { status: 503 });
}

export async function POST(request: Request) {
  if (!isQdrantConfigured()) {
    return serviceUnavailable("Qdrant is not configured. Copy .env.example to .env.local.");
  }
  if (!isRagProviderConfigured()) {
    return serviceUnavailable(getRagProviderConfigurationMessage());
  }

  const dependencies: RagDependencies = {
    collectionExists,
    async embedQuery(question) {
      const result = await embedTexts([question]);
      if (!result.vectors[0]) throw new Error("No query vector was returned.");
      return { vector: result.vectors[0], promptTokens: result.promptTokens };
    },
    async search(vector, topK) {
      const response = await getQdrantClient().query(getCollectionName(), {
        query: vector,
        limit: topK,
        with_payload: true,
        with_vector: false,
      });
      return response.points;
    },
    generateAnswer: generateGroundedAnswer,
  };

  return handleAskRequest(request, dependencies);
}

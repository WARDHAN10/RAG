import type { TextChunk } from "@/lib/chunk-text";

export type StoredDocument = {
  id: string;
  name: string;
  bytes: number;
  characters: number;
  chunkCount: number;
  embeddingTokens?: number;
  embeddingCostUsd?: number;
  embeddingMs?: number;
  previewChunks: TextChunk[];
  createdAt: string;
};

export type VectorHealth = {
  qdrantConfigured: boolean;
  qdrantConnected: boolean;
  embeddingConfigured: boolean;
  ragMode: "offline" | "online";
  modeConfigured: boolean;
  providerName: string;
  embeddingModel: string;
  answerModel: string;
  vectorSize: number | null;
  indexedVectorSize: number | null;
  vectorDimensionsMatch: boolean | null;
  indexMessage: string | null;
  providerConnected: boolean;
  providerMessage: string | null;
  ready: boolean;
};

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
  ready: boolean;
};

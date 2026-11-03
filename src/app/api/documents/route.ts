import { randomUUID } from "node:crypto";
import { DocumentTextExtractionError, extractDocumentText } from "@/lib/extract-text";
import { embedTexts } from "@/lib/embeddings";
import { EMBEDDING_USD_PER_MILLION_TOKENS } from "@/lib/openai-pricing";
import type { StoredDocument } from "@/lib/document-types";
import { chunkText } from "@/lib/chunk-text";
import { createChunkId } from "@/lib/rag-core";
import { collectionExists, ensureCollection, getCollectionName, getQdrantClient, isQdrantConfigured } from "@/lib/qdrant";
import { getRagMode, getRagProviderConfigurationMessage, isRagProviderConfigured } from "@/lib/rag-config";
import { handleResetRequest } from "@/lib/reset-handler";

const MAX_FILE_SIZE = 2 * 1024 * 1024;
const MAX_CHUNKS = 2500;
const EMBEDDING_BATCH_SIZE = 128;

type ChunkPayload = {
  documentId?: unknown;
  name?: unknown;
  bytes?: unknown;
  characters?: unknown;
  createdAt?: unknown;
  chunkIndex?: unknown;
  chunkText?: unknown;
  embeddingTokens?: unknown;
  embeddingCostUsd?: unknown;
  embeddingMs?: unknown;
};

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export async function GET() {
  if (!isQdrantConfigured()) {
    return jsonError("Qdrant is not configured. Copy .env.example to .env.local.", 503);
  }

  try {
    const client = getQdrantClient();
    const collectionName = getCollectionName();
    const collections = await client.getCollections();
    if (!collections.collections.some((collection) => collection.name === collectionName)) {
      return Response.json(
        { documents: [] },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const documents = new Map<string, StoredDocument>();
    let offset: string | number | undefined;

    while (true) {
      const page = await client.scroll(collectionName, {
        limit: 256,
        with_payload: true,
        with_vector: false,
        ...(offset === undefined ? {} : { offset }),
      });

      for (const point of page.points) {
        const payload = point.payload as ChunkPayload | null;
        if (
          !payload ||
          typeof payload.documentId !== "string" ||
          typeof payload.name !== "string"
        ) {
          continue;
        }

        let document = documents.get(payload.documentId);
        if (!document) {
          document = {
            id: payload.documentId,
            name: payload.name,
            bytes: typeof payload.bytes === "number" ? payload.bytes : 0,
            characters: typeof payload.characters === "number" ? payload.characters : 0,
            chunkCount: 0,
            ...(typeof payload.embeddingTokens === "number" ? { embeddingTokens: payload.embeddingTokens } : {}),
            ...(typeof payload.embeddingCostUsd === "number" ? { embeddingCostUsd: payload.embeddingCostUsd } : {}),
            ...(typeof payload.embeddingMs === "number" ? { embeddingMs: payload.embeddingMs } : {}),
            previewChunks: [],
            createdAt: typeof payload.createdAt === "string" ? payload.createdAt : "",
          };
          documents.set(payload.documentId, document);
        }

        document.chunkCount += 1;
        if (
          typeof payload.chunkText === "string" &&
          typeof payload.chunkIndex === "number"
        ) {
          document.previewChunks.push({
            index: payload.chunkIndex,
            text: payload.chunkText,
          });
          document.previewChunks.sort((left, right) => left.index - right.index);
          if (document.previewChunks.length > 3) document.previewChunks.pop();
        }
      }

      const nextOffset = page.next_page_offset;
      if (nextOffset === null || nextOffset === undefined) break;
      if (typeof nextOffset !== "string" && typeof nextOffset !== "number") break;
      offset = nextOffset;
    }

    const result = [...documents.values()]
      .map((document) => ({
        ...document,
        previewChunks: document.previewChunks.sort((left, right) => left.index - right.index),
      }))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));

    return Response.json(
      { documents: result },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return jsonError("Could not read the Qdrant index. Check QDRANT_URL and try again.", 503);
  }
}

export async function DELETE(request: Request) {
  if (!isQdrantConfigured()) {
    return jsonError("Qdrant is not configured. Copy .env.example to .env.local.", 503);
  }

  return handleResetRequest(request, async () => {
    const client = getQdrantClient();
    const collectionName = getCollectionName();
    if (await collectionExists()) {
      await client.deleteCollection(collectionName);
    }
    await ensureCollection();
  });
}

export async function POST(request: Request) {
  if (!isQdrantConfigured()) {
    return jsonError("Qdrant is not configured. Copy .env.example to .env.local.", 503);
  }
  if (!isRagProviderConfigured()) {
    return jsonError(getRagProviderConfigurationMessage(), 503);
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return jsonError("Choose a .txt, .doc, or .pdf file to upload.", 400);
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return jsonError("Choose a .txt, .doc, or .pdf file to upload.", 400);
  }
  const extension = file.name.toLowerCase().split(".").pop();
  if (extension !== "txt" && extension !== "doc" && extension !== "pdf") {
    return jsonError("Only .txt, .doc, and .pdf files are supported.", 400);
  }
  if (file.size === 0) {
    return jsonError("This file is empty.", 400);
  }
  if (file.size > MAX_FILE_SIZE) {
    return jsonError("Files must be 2 MB or smaller.", 413);
  }

  let text: string;
  try {
    text = await extractDocumentText(file.name, new Uint8Array(await file.arrayBuffer()));
  } catch (error) {
    return jsonError(
      error instanceof DocumentTextExtractionError
        ? error.message
        : "Could not extract text from this document.",
      400,
    );
  }

  const chunks = chunkText(text);
  if (chunks.length === 0) {
    return jsonError("This file is empty.", 400);
  }
  if (chunks.length > MAX_CHUNKS) {
    return jsonError("This file creates too many chunks. Split it into smaller files.", 413);
  }

  const documentId = randomUUID();
  const createdAt = new Date().toISOString();
  let vectors: number[][];
  let embeddingTokens = 0;
  let embeddingMs = 0;

  try {
    await ensureCollection();
  } catch {
    return jsonError(
      "Could not prepare the Qdrant collection. Check Qdrant, and use Reset index after changing embedding modes or dimensions.",
      503,
    );
  }

  try {
    const embeddingStartedAt = Date.now();
    const embeddingResult = await embedTexts(chunks.map((chunk) => chunk.text));
    vectors = embeddingResult.vectors;
    embeddingTokens = embeddingResult.promptTokens;
    embeddingMs = Date.now() - embeddingStartedAt;
  } catch {
    return jsonError(
      getRagMode() === "offline"
        ? "Could not create local embeddings. Check Ollama and the configured embedding model."
        : "Could not create embeddings. Check OPENAI_API_KEY and try again.",
      502,
    );
  }
  const embeddingCostUsd = getRagMode() === "offline"
    ? 0
    : (embeddingTokens / 1_000_000) * EMBEDDING_USD_PER_MILLION_TOKENS;

  const client = getQdrantClient();
  const collectionName = getCollectionName();
  const points = chunks.map((chunk, index) => ({
    id: randomUUID(),
    vector: vectors[index],
    payload: {
      documentId,
      name: file.name.slice(0, 255),
      chunkId: createChunkId(file.name.slice(0, 255), chunk.index, chunk.text),
      bytes: file.size,
      characters: text.trim().length,
      embeddingTokens,
      embeddingCostUsd,
      embeddingMs,
      createdAt,
      chunkIndex: chunk.index,
      chunkText: chunk.text,
    },
  }));

  try {
    for (let start = 0; start < points.length; start += EMBEDDING_BATCH_SIZE) {
      await client.upsert(collectionName, {
        wait: true,
        points: points.slice(start, start + EMBEDDING_BATCH_SIZE),
      });
    }
  } catch {
    await client
      .delete(collectionName, {
        wait: true,
        filter: {
          must: [{ key: "documentId", match: { value: documentId } }],
        },
      })
      .catch(() => undefined);
    return jsonError("Could not save the document to Qdrant. Check the database and retry.", 503);
  }

  const document: StoredDocument = {
    id: documentId,
    name: file.name.slice(0, 255),
    bytes: file.size,
    characters: text.trim().length,
    chunkCount: chunks.length,
    embeddingTokens,
    embeddingCostUsd,
    embeddingMs,
    previewChunks: chunks.slice(0, 3),
    createdAt,
  };

  return Response.json({ document }, { status: 201 });
}

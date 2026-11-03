import assert from "node:assert/strict";
import test from "node:test";
import { handleAskRequest } from "../src/lib/ask-handler";
import { createChunkId } from "../src/lib/rag-core";
import { getVectorSize } from "../src/lib/rag-config";
import type { RagDependencies } from "../src/lib/rag-service";

function dependencies(overrides: Partial<RagDependencies> = {}): RagDependencies {
  return {
    collectionExists: async () => false,
    embedQuery: async () => ({ vector: [], promptTokens: 0 }),
    search: async () => [],
    generateAnswer: async () => { throw new Error("not called"); },
    ...overrides,
  };
}

function request(body: string, headers: HeadersInit = { "Content-Type": "application/json" }) {
  return new Request("http://localhost/api/ask", { method: "POST", headers, body });
}

test("API handler rejects invalid JSON and invalid question fields", async () => {
  const invalidJson = await handleAskRequest(request("{"), dependencies());
  assert.equal(invalidJson.status, 400);
  assert.match((await invalidJson.json()).error, /valid JSON/);

  const invalidQuestion = await handleAskRequest(request(JSON.stringify({ question: "  " })), dependencies());
  assert.equal(invalidQuestion.status, 400);
});

test("API handler rejects oversized bodies before parsing", async () => {
  const response = await handleAskRequest(
    request("{}", { "Content-Type": "application/json", "Content-Length": String(16 * 1024 + 1) }),
    dependencies(),
  );
  assert.equal(response.status, 413);
});

test("API handler returns Qdrant errors without leaking provider details", async () => {
  const response = await handleAskRequest(
    request(JSON.stringify({ question: "Question?" })),
    dependencies({ collectionExists: async () => { throw new Error("internal URL/token"); } }),
  );
  assert.equal(response.status, 503);
  assert.doesNotMatch(JSON.stringify(await response.json()), /internal URL|token/);
});

test("retrieval request passes a mocked query embedding to mocked Qdrant and returns ranked chunk details", async () => {
  const previousMode = process.env.RAG_MODE;
  process.env.RAG_MODE = "offline";
  const text = "The handbook says a support request is acknowledged within one business day.";
  const chunkId = createChunkId("handbook.txt", 1, text);
  const vector = Array.from({ length: getVectorSize() }, () => 0.1);
  let receivedQuestion = "";
  let receivedTopK = 0;

  try {
    const response = await handleAskRequest(
      request(JSON.stringify({ question: "When is a support request acknowledged?" })),
      dependencies({
        collectionExists: async () => true,
        embedQuery: async (question) => {
          receivedQuestion = question;
          return { vector, promptTokens: 7 };
        },
        search: async (queryVector, topK) => {
          assert.deepEqual(queryVector, vector);
          receivedTopK = topK;
          return [{
            id: "qdrant-point-1",
            score: 0.87,
            payload: {
              documentId: "doc-1",
              name: "handbook.txt",
              chunkId,
              chunkIndex: 1,
              chunkText: text,
            },
          }];
        },
        generateAnswer: async () => ({
          output: { answer: "Within one business day [S1].", abstained: false, citations: ["S1"] },
          model: "mock-answer-model",
          inputTokens: 20,
          cachedInputTokens: 0,
          outputTokens: 8,
        }),
      }),
    );

    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(receivedQuestion, "When is a support request acknowledged?");
    assert.equal(receivedTopK, 5);
    assert.equal(result.sources[0].chunkId, chunkId);
    assert.equal(result.sources[0].documentName, "handbook.txt");
    assert.equal(result.sources[0].rank, 1);
    assert.equal(result.sources[0].score, 0.87);
    assert.equal(result.sources[0].text, text);
    assert.equal(result.metrics.totalRetrievalMs, result.metrics.queryEmbeddingMs + result.metrics.vectorRetrievalMs);
  } finally {
    if (previousMode === undefined) delete process.env.RAG_MODE;
    else process.env.RAG_MODE = previousMode;
  }
});

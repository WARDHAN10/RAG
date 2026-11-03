import assert from "node:assert/strict";
import test from "node:test";
import { RagPipelineError, runBasicRag, type RagDependencies } from "../src/lib/rag-service";
import { getVectorSize } from "../src/lib/rag-config";

process.env.RAG_MODE = "online";

const point = {
  id: "point-1",
  score: 0.83,
  payload: {
    documentId: "doc-1",
    name: "guide.txt",
    chunkIndex: 1,
    chunkText: "The guide allows remote work three days per week.",
  },
};

function dependencies(overrides: Partial<RagDependencies> = {}): RagDependencies {
  return {
    collectionExists: async () => true,
    embedQuery: async () => ({ vector: Array.from({ length: getVectorSize() }, () => 0.1), promptTokens: 20 }),
    search: async () => [point],
    generateAnswer: async () => ({
      output: { answer: "Three days per week [S1].", abstained: false, citations: ["S1"] },
      model: "gpt-5.4-mini",
      inputTokens: 500,
      cachedInputTokens: 0,
      outputTokens: 100,
    }),
    now: (() => {
      let value = 0;
      return () => (value += 10);
    })(),
    ...overrides,
  };
}

test("empty collection returns a clear state without embedding or generation", async () => {
  let embedded = false;
  const result = await runBasicRag(
    { question: "Any question?", topK: 5 },
    dependencies({
      collectionExists: async () => false,
      embedQuery: async () => {
        embedded = true;
        return { vector: [], promptTokens: 0 };
      },
    }),
    0,
  );
  assert.equal(result.status, "empty");
  assert.equal(result.abstained, true);
  assert.equal(result.metrics.estimatedQueryCostUsd, 0);
  assert.equal(embedded, false);
});

test("empty retrieval skips answer generation and reports only query embedding cost", async () => {
  let generated = false;
  const result = await runBasicRag(
    { question: "Any question?", topK: 5 },
    dependencies({
      search: async () => [],
      generateAnswer: async () => {
        generated = true;
        throw new Error("must not be called");
      },
    }),
    0,
  );
  assert.equal(result.status, "no-results");
  assert.equal(result.sources.length, 0);
  assert.equal(result.metrics.chunksRetrieved, 0);
  assert.equal(result.metrics.answerGenerationMs, null);
  assert.equal(result.metrics.collectionCheckMs, 10);
  assert.equal(result.metrics.vectorRetrievalMs, 10);
  assert.equal(result.metrics.totalRetrievalMs, 20);
  assert.ok(Math.abs((result.metrics.estimatedQueryCostUsd ?? 0) - 0.0000004) < 1e-12);
  assert.equal(generated, false);
});

test("a grounded answer returns citations, source metadata, timings, usage, and estimated cost", async () => {
  const result = await runBasicRag(
    { question: "How many remote days?", topK: 5 },
    dependencies(),
    0,
  );
  assert.equal(result.status, "answered");
  assert.deepEqual(result.citations, ["S1"]);
  assert.equal(result.sources[0].documentName, "guide.txt");
  assert.equal(result.sources[0].rank, 1);
  assert.equal(result.sources[0].score, 0.83);
  assert.equal(result.metrics.chunksRetrieved, 1);
  assert.equal(result.metrics.collectionCheckMs, 10);
  assert.equal(result.metrics.queryEmbeddingMs, 10);
  assert.equal(result.metrics.vectorRetrievalMs, 10);
  assert.equal(result.metrics.totalRetrievalMs, 20);
  assert.equal(result.metrics.answerGenerationMs, 10);
  assert.ok(result.metrics.estimatedQueryCostUsd !== null);
});

test("Qdrant and model failures map to safe API error statuses", async () => {
  await assert.rejects(
    () => runBasicRag({ question: "Q", topK: 5 }, dependencies({ collectionExists: async () => { throw new Error("secret detail"); } }), 0),
    (error: unknown) => error instanceof RagPipelineError && error.status === 503 && !error.message.includes("secret detail"),
  );
  await assert.rejects(
    () => runBasicRag({ question: "Q", topK: 5 }, dependencies({ search: async () => { throw new Error("database detail"); } }), 0),
    (error: unknown) => error instanceof RagPipelineError && error.status === 503 && /search Qdrant/.test(error.message),
  );
  await assert.rejects(
    () => runBasicRag({ question: "Q", topK: 5 }, dependencies({ generateAnswer: async () => { throw new Error("provider detail"); } }), 0),
    (error: unknown) => error instanceof RagPipelineError && error.status === 502 && !error.message.includes("provider detail"),
  );
});

test("a malformed embedding vector is rejected before Qdrant search", async () => {
  let searched = false;
  await assert.rejects(
    () => runBasicRag(
      { question: "Q", topK: 5 },
      dependencies({
        embedQuery: async () => ({ vector: [0.1], promptTokens: 1 }),
        search: async () => {
          searched = true;
          return [];
        },
      }),
      0,
    ),
    (error: unknown) => error instanceof RagPipelineError && error.status === 502,
  );
  assert.equal(searched, false);
});

test("offline queries report zero model API cost", async () => {
  const previousMode = process.env.RAG_MODE;
  process.env.RAG_MODE = "offline";
  try {
    const result = await runBasicRag(
      { question: "How many remote days?", topK: 5 },
      dependencies(),
      0,
    );
    assert.equal(result.metrics.estimatedQueryCostUsd, 0);
  } finally {
    if (previousMode === undefined) delete process.env.RAG_MODE;
    else process.env.RAG_MODE = previousMode;
  }
});

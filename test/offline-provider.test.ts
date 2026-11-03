import assert from "node:assert/strict";
import test from "node:test";
import { embedTexts } from "../src/lib/embeddings";
import { generateGroundedAnswer } from "../src/lib/generation";
import { createChunkId } from "../src/lib/rag-core";
import type { RetrievedSource } from "../src/lib/rag-core";
import {
  getAnswerModel,
  getEmbeddingModel,
  getRagMode,
  getRagModeConfigurationError,
  getVectorSize,
  isRagProviderConfigured,
} from "../src/lib/rag-config";

const environmentKeys = [
  "RAG_MODE",
  "OLLAMA_BASE_URL",
  "OLLAMA_EMBEDDING_MODEL",
  "OLLAMA_CHAT_MODEL",
  "EMBEDDING_DIMENSIONS",
  "OPENAI_API_KEY",
] as const;

function saveEnvironment() {
  return Object.fromEntries(environmentKeys.map((key) => [key, process.env[key]]));
}

function restoreEnvironment(saved: Record<string, string | undefined>) {
  for (const key of environmentKeys) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
}

test("provider mode must be explicitly selected and offline defaults to a small local stack", () => {
  const saved = saveEnvironment();
  try {
    delete process.env.RAG_MODE;
    delete process.env.EMBEDDING_DIMENSIONS;
    assert.equal(getRagMode(), "offline");
    assert.match(getRagModeConfigurationError() ?? "", /RAG_MODE=offline or RAG_MODE=online/);
    assert.equal(isRagProviderConfigured(), false);

    process.env.RAG_MODE = "offline";
    assert.equal(getEmbeddingModel(), "all-minilm");
    assert.equal(getAnswerModel(), "qwen3:0.6b");
    assert.equal(getVectorSize(), 384);
  } finally {
    restoreEnvironment(saved);
  }
});

test("offline embeddings call Ollama locally and validate returned dimensions", async () => {
  const saved = saveEnvironment();
  const originalFetch = globalThis.fetch;
  try {
    process.env.RAG_MODE = "offline";
    process.env.OLLAMA_BASE_URL = "http://127.0.0.1:11434";
    process.env.OLLAMA_EMBEDDING_MODEL = "fixture-embed";
    process.env.EMBEDDING_DIMENSIONS = "3";
    delete process.env.OPENAI_API_KEY;
    globalThis.fetch = async (input, init) => {
      assert.equal(String(input), "http://127.0.0.1:11434/api/embed");
      const body = JSON.parse(String(init?.body)) as { model: string; input: string[] };
      assert.equal(body.model, "fixture-embed");
      assert.deepEqual(body.input, ["first chunk", "second chunk"]);
      return Response.json({ embeddings: [[1, 0, 0], [0, 1, 0]], prompt_eval_count: 9 });
    };

    const result = await embedTexts(["first chunk", "second chunk"]);
    assert.deepEqual(result.vectors, [[1, 0, 0], [0, 1, 0]]);
    assert.equal(result.promptTokens, 9);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvironment(saved);
  }
});

test("offline answer generation requests schema-constrained JSON from Ollama", async () => {
  const saved = saveEnvironment();
  const originalFetch = globalThis.fetch;
  const source: RetrievedSource = {
    citationId: "S1",
    chunkId: createChunkId("guide.txt", 1, "The guide allows three remote days each week."),
    pointId: "point-1",
    documentId: "doc-1",
    documentName: "guide.txt",
    chunkIndex: 1,
    rank: 1,
    score: 0.8,
    text: "The guide allows three remote days each week.",
  };

  try {
    process.env.RAG_MODE = "offline";
    process.env.OLLAMA_BASE_URL = "http://127.0.0.1:11434";
    process.env.OLLAMA_CHAT_MODEL = "fixture-chat";
    globalThis.fetch = async (input, init) => {
      assert.equal(String(input), "http://127.0.0.1:11434/api/chat");
      const body = JSON.parse(String(init?.body)) as { model: string; stream: boolean; format: unknown };
      assert.equal(body.model, "fixture-chat");
      assert.equal(body.stream, false);
      assert.equal(typeof body.format, "object");
      return Response.json({
        model: "fixture-chat",
        done: true,
        message: {
          content: JSON.stringify({
            answer: "Three days per week [S1].",
            abstained: false,
            citations: ["S1"],
          }),
        },
        prompt_eval_count: 120,
        eval_count: 18,
      });
    };

    const result = await generateGroundedAnswer("How many remote days?", [source]);
    assert.equal(result.model, "fixture-chat");
    assert.deepEqual(result.output, {
      answer: "Three days per week [S1].",
      abstained: false,
      citations: ["S1"],
    });
    assert.equal(result.inputTokens, 120);
    assert.equal(result.outputTokens, 18);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvironment(saved);
  }
});

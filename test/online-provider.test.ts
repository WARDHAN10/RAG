import assert from "node:assert/strict";
import test from "node:test";
import { embedTexts } from "../src/lib/embeddings";
import { getEmbeddingModel } from "../src/lib/rag-config";

test("online query embeddings use text-embedding-3-small through a mocked OpenAI response", async () => {
  const previousMode = process.env.RAG_MODE;
  const previousApiKey = process.env.OPENAI_API_KEY;
  const previousDimensions = process.env.EMBEDDING_DIMENSIONS;
  const originalFetch = globalThis.fetch;
  try {
    process.env.RAG_MODE = "online";
    process.env.OPENAI_API_KEY = "mock-openai-key";
    delete process.env.EMBEDDING_DIMENSIONS;

    globalThis.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      assert.equal(url, "https://api.openai.com/v1/embeddings");
      const body = JSON.parse(String(init?.body)) as {
        model: string;
        input: string[];
        dimensions: number;
      };
      assert.equal(body.model, "text-embedding-3-small");
      assert.deepEqual(body.input, ["test question"]);
      assert.equal(body.dimensions, 1536);
      return Response.json({
        data: [{ object: "embedding", index: 0, embedding: Array.from({ length: 1536 }, () => 0.25) }],
        model: "text-embedding-3-small",
        usage: { prompt_tokens: 4, total_tokens: 4 },
      });
    };

    assert.equal(getEmbeddingModel(), "text-embedding-3-small");
    const result = await embedTexts(["test question"]);
    assert.equal(result.vectors.length, 1);
    assert.equal(result.vectors[0].length, 1536);
    assert.equal(result.promptTokens, 4);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousMode === undefined) delete process.env.RAG_MODE;
    else process.env.RAG_MODE = previousMode;
    if (previousApiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousApiKey;
    if (previousDimensions === undefined) delete process.env.EMBEDDING_DIMENSIONS;
    else process.env.EMBEDDING_DIMENSIONS = previousDimensions;
  }
});

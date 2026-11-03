import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { chunkText } from "../src/lib/chunk-text";
import { createChunkId } from "../src/lib/rag-core";

test("evaluation relevance labels reference chunk IDs generated from the bundled source files", () => {
  const documentsDirectory = path.join(process.cwd(), "evals/fixtures/documents");
  const availableChunkIds = new Set<string>();
  for (const documentName of readdirSync(documentsDirectory).filter((name) => name.endsWith(".txt"))) {
    const text = readFileSync(path.join(documentsDirectory, documentName), "utf8");
    for (const chunk of chunkText(text)) {
      availableChunkIds.add(createChunkId(documentName, chunk.index, chunk.text));
    }
  }

  const fixture = JSON.parse(
    readFileSync(path.join(process.cwd(), "evals/fixtures/level1-cases.json"), "utf8"),
  ) as { requiredDocuments: string[]; cases: Array<{ relevantChunkIds: string[] }> };
  assert.deepEqual([...fixture.requiredDocuments].sort(), readdirSync(documentsDirectory).filter((name) => name.endsWith(".txt")).sort());
  const labels = fixture.cases.flatMap((testCase) => testCase.relevantChunkIds);
  assert.ok(labels.length > 0);
  assert.ok(labels.every((chunkId) => availableChunkIds.has(chunkId)));
});

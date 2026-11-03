import assert from "node:assert/strict";
import test from "node:test";
import {
  AskInputError,
  buildEvidenceContext,
  createChunkId,
  mapRetrievedPoints,
  normalizeModelAnswer,
  validateAskInput,
  type RetrievedSource,
} from "../src/lib/rag-core";

const source: RetrievedSource = {
  citationId: "S1",
  chunkId: createChunkId("guide.txt", 2, "The guide says the service is available three days per week."),
  pointId: "point-1",
  documentId: "document-1",
  documentName: "guide.txt",
  chunkIndex: 2,
  rank: 1,
  score: 0.82,
  text: "The guide says the service is available three days per week.",
};

test("question validation trims input and applies the default topK", () => {
  assert.deepEqual(validateAskInput({ question: "  Where is the guide?  " }), {
    question: "Where is the guide?",
    topK: 5,
  });
});

test("question validation rejects blank, oversized, and invalid topK values", () => {
  assert.throws(() => validateAskInput({ question: "  " }), AskInputError);
  assert.throws(() => validateAskInput({ question: "A".repeat(2001) }), AskInputError);
  assert.throws(() => validateAskInput({ question: "Q", topK: 9 }), AskInputError);
  assert.throws(() => validateAskInput(null), AskInputError);
});

test("retrieval mapping skips malformed points and preserves Qdrant rank", () => {
  const results = mapRetrievedPoints([
    { id: "bad", score: 0.9, payload: { name: "missing text" } },
    {
      id: "point-2",
      score: 0.71,
      payload: { documentId: "doc-2", name: "runbook.pdf", chunkIndex: 4, chunkText: "Restart the worker." },
    },
  ]);

  assert.equal(results.length, 1);
  assert.deepEqual(results[0], {
    citationId: "S1",
    chunkId: createChunkId("runbook.pdf", 4, "Restart the worker."),
    pointId: "point-2",
    documentId: "doc-2",
    documentName: "runbook.pdf",
    chunkIndex: 4,
    rank: 2,
    score: 0.71,
    text: "Restart the worker.",
  });
});

test("citations are restricted to retrieved chunks", () => {
  const result = normalizeModelAnswer(
    { answer: "It allows three days [S1] and a bonus [S9].", abstained: false, citations: ["S1", "S9"] },
    [source],
  );
  assert.equal(result.abstained, false);
  assert.equal(result.answer, "It allows three days [S1] and a bonus .");
  assert.deepEqual(result.citations, ["S1"]);
});

test("an answer without any valid citation becomes an abstention", () => {
  const result = normalizeModelAnswer(
    { answer: "The policy allows three days.", abstained: false, citations: ["S99"] },
    [source],
  );
  assert.equal(result.abstained, true);
  assert.deepEqual(result.citations, []);
});

test("explicit model abstention uses a stable insufficient-evidence message", () => {
  const result = normalizeModelAnswer(
    { answer: "I am not sure.", abstained: true, citations: [] },
    [source],
  );
  assert.equal(result.answer, "The available documents do not contain enough information to answer.");
  assert.equal(result.abstained, true);
});

test("malformed structured model responses are rejected", () => {
  assert.throws(
    () => normalizeModelAnswer({ answer: "", abstained: false, citations: [] }, [source]),
  );
  assert.throws(
    () => normalizeModelAnswer({ answer: "Answer", abstained: false, citations: "S1" }, [source]),
  );
});

test("evidence sent to the model is bounded", () => {
  const longSource = { ...source, text: "x".repeat(20_000) };
  const context = buildEvidenceContext([longSource, { ...source, citationId: "S2" }]);
  assert.equal(context.map((item) => item.text.length).reduce((a, b) => a + b, 0), 10_000);
});

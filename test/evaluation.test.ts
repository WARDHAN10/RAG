import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateAnswerGenerationSummary,
  calculateRetrievalSummary,
  summarizeQueryPerformance,
} from "../src/lib/evaluation";

test("retrieval evaluation computes Hit Rate@K, macro Recall@K, and MRR from chunk IDs", () => {
  const result = calculateRetrievalSummary([
    {
      relevantChunkIds: ["a#chunk-1", "b#chunk-1"],
      retrievedChunkIds: ["a#chunk-1"],
    },
    {
      relevantChunkIds: ["c#chunk-1"],
      retrievedChunkIds: [],
    },
    {
      relevantChunkIds: [],
      retrievedChunkIds: ["unlabeled#chunk-1"],
    },
  ], 1);

  assert.equal(result.retrievalLabeledCases, 2);
  assert.equal(result.hitRateAtK, 0.5);
  assert.equal(result.precisionAtK, 0.5);
  assert.equal(result.macroRecallAtK, 0.25);
  assert.equal(result.meanReciprocalRankAtK, 0.5);
  assert.equal(result.ndcgAtK, 0.5);
});

test("retrieval metrics stay unavailable when no relevance labels exist", () => {
  const result = calculateRetrievalSummary([{ relevantChunkIds: [], retrievedChunkIds: ["a"] }]);
  assert.equal(result.retrievalLabeledCases, 0);
  assert.equal(result.hitRateAtK, null);
  assert.equal(result.precisionAtK, null);
  assert.equal(result.macroRecallAtK, null);
  assert.equal(result.meanReciprocalRankAtK, null);
  assert.equal(result.ndcgAtK, null);
});

test("answer-generation abstention evaluation is separate from retrieval", () => {
  const result = calculateAnswerGenerationSummary([
    { shouldAbstain: false, abstained: false },
    { shouldAbstain: true, abstained: true },
    { shouldAbstain: false, abstained: true },
  ]);
  assert.equal(result.answerCases, 3);
  assert.equal(result.abstentionCases, 1);
  assert.equal(result.abstentionAccuracy, 2 / 3);
  assert.equal(result.answerQuality, "Manual review required");
});

test("query performance summarizes average and percentile latency by stage", () => {
  const base = {
    collectionCheckMs: 1,
    queryEmbeddingMs: 2,
    vectorRetrievalMs: 3,
    totalRetrievalMs: 5,
    answerGenerationMs: 4,
    totalMs: 10,
    chunksRetrieved: 2,
    queryEmbeddingTokens: 5,
    answerInputTokens: 100,
    answerCachedInputTokens: 0,
    answerOutputTokens: 20,
    estimatedQueryCostUsd: 0.001,
    answerModel: "test-model",
  } as const;
  const result = summarizeQueryPerformance([
    { ...base },
    {
      ...base,
      collectionCheckMs: 3,
      queryEmbeddingMs: 6,
      vectorRetrievalMs: 9,
      totalRetrievalMs: 15,
      answerGenerationMs: 12,
      totalMs: 30,
      chunksRetrieved: 4,
      queryEmbeddingTokens: 15,
      answerInputTokens: 300,
      answerOutputTokens: 60,
      estimatedQueryCostUsd: 0.003,
    },
  ]);

  assert.equal(result.queryCount, 2);
  assert.equal(result.latencyMs.vectorSearch.samples, 2);
  assert.equal(result.latencyMs.vectorSearch.average, 6);
  assert.equal(result.latencyMs.vectorSearch.p50, 6);
  assert.equal(result.latencyMs.vectorSearch.p95, 9);
  assert.equal(result.latencyMs.totalRetrieval.average, 10);
  assert.equal(result.latencyMs.serverTotal.average, 20);
  assert.equal(result.averages.chunksRetrieved, 3);
  assert.equal(result.averages.estimatedQueryCostUsd, 0.002);
});

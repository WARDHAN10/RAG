import type { QueryMetrics } from "./rag-core";

export type RetrievalEvaluationObservation = {
  relevantChunkIds: string[];
  retrievedChunkIds: string[];
};

export type AnswerGenerationObservation = {
  shouldAbstain: boolean;
  abstained: boolean;
};

export type RetrievalEvaluationSummary = {
  retrievalLabeledCases: number;
  hitRateAtK: number | null;
  precisionAtK: number | null;
  macroRecallAtK: number | null;
  meanReciprocalRankAtK: number | null;
  ndcgAtK: number | null;
};

export type AnswerGenerationEvaluationSummary = {
  answerCases: number;
  abstentionCases: number;
  abstentionAccuracy: number | null;
  answerQuality: "Manual review required";
};

export type MetricDistribution = {
  samples: number;
  average: number | null;
  p50: number | null;
  p95: number | null;
};

export type QueryPerformanceSummary = {
  queryCount: number;
  latencyMs: {
    collectionCheck: MetricDistribution;
    queryEmbedding: MetricDistribution;
    vectorSearch: MetricDistribution;
    totalRetrieval: MetricDistribution;
    answerGeneration: MetricDistribution;
    serverTotal: MetricDistribution;
  };
  averages: {
    chunksRetrieved: number | null;
    queryEmbeddingTokens: number | null;
    answerInputTokens: number | null;
    answerOutputTokens: number | null;
    estimatedQueryCostUsd: number | null;
  };
};

export function calculateRetrievalSummary(
  observations: readonly RetrievalEvaluationObservation[],
  topK = 5,
): RetrievalEvaluationSummary {
  const k = Number.isInteger(topK) && topK > 0 ? topK : 5;
  const labeled = observations.filter((observation) => observation.relevantChunkIds.length > 0);
  const caseScores = labeled.map((observation) => {
    const relevant = new Set(observation.relevantChunkIds);
    const retrieved = observation.retrievedChunkIds.slice(0, k);
    const firstRankByChunk = new Map<string, number>();
    retrieved.forEach((chunkId, index) => {
      if (!firstRankByChunk.has(chunkId)) firstRankByChunk.set(chunkId, index + 1);
    });

    const relevantRanks = [...firstRankByChunk.entries()]
      .filter(([chunkId]) => relevant.has(chunkId))
      .map(([, rank]) => rank);
    const dcg = relevantRanks.reduce((sum, rank) => sum + 1 / Math.log2(rank + 1), 0);
    const idealRelevantCount = Math.min(relevant.size, k);
    const idealDcg = Array.from({ length: idealRelevantCount }, (_, index) =>
      1 / Math.log2(index + 2),
    ).reduce((sum, gain) => sum + gain, 0);

    return {
      hit: relevantRanks.length > 0 ? 1 : 0,
      precision: relevantRanks.length / k,
      recall: relevantRanks.length / relevant.size,
      reciprocalRank: relevantRanks.length > 0 ? 1 / Math.min(...relevantRanks) : 0,
      ndcg: idealDcg > 0 ? dcg / idealDcg : 0,
    };
  });
  const averageScore = (field: "hit" | "precision" | "recall" | "reciprocalRank" | "ndcg") =>
    caseScores.length
      ? caseScores.reduce((sum, score) => sum + score[field], 0) / caseScores.length
      : null;

  return {
    retrievalLabeledCases: labeled.length,
    hitRateAtK: averageScore("hit"),
    precisionAtK: averageScore("precision"),
    macroRecallAtK: averageScore("recall"),
    meanReciprocalRankAtK: averageScore("reciprocalRank"),
    ndcgAtK: averageScore("ndcg"),
  };
}

export function calculateAnswerGenerationSummary(
  observations: readonly AnswerGenerationObservation[],
): AnswerGenerationEvaluationSummary {
  const correctDecisions = observations.filter(
    (observation) => observation.shouldAbstain === observation.abstained,
  );
  return {
    answerCases: observations.length,
    abstentionCases: observations.filter((observation) => observation.shouldAbstain).length,
    abstentionAccuracy: observations.length ? correctDecisions.length / observations.length : null,
    answerQuality: "Manual review required",
  };
}

function distribution(values: readonly (number | null)[]): MetricDistribution {
  const sorted = values
    .filter((value): value is number => value !== null && Number.isFinite(value) && value >= 0)
    .sort((left, right) => left - right);
  if (sorted.length === 0) return { samples: 0, average: null, p50: null, p95: null };

  const middle = Math.floor(sorted.length / 2);
  const p50 = sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
  const p95 = sorted[Math.max(0, Math.ceil(0.95 * sorted.length) - 1)];
  return {
    samples: sorted.length,
    average: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
    p50,
    p95,
  };
}

function average(values: readonly (number | null)[]) {
  const present = values.filter((value): value is number => value !== null && Number.isFinite(value) && value >= 0);
  return present.length ? present.reduce((sum, value) => sum + value, 0) / present.length : null;
}

export function summarizeQueryPerformance(metrics: readonly QueryMetrics[]): QueryPerformanceSummary {
  return {
    queryCount: metrics.length,
    latencyMs: {
      collectionCheck: distribution(metrics.map((metric) => metric.collectionCheckMs)),
      queryEmbedding: distribution(metrics.map((metric) => metric.queryEmbeddingMs)),
      vectorSearch: distribution(metrics.map((metric) => metric.vectorRetrievalMs)),
      totalRetrieval: distribution(metrics.map((metric) => metric.totalRetrievalMs)),
      answerGeneration: distribution(metrics.map((metric) => metric.answerGenerationMs)),
      serverTotal: distribution(metrics.map((metric) => metric.totalMs)),
    },
    averages: {
      chunksRetrieved: average(metrics.map((metric) => metric.chunksRetrieved)),
      queryEmbeddingTokens: average(metrics.map((metric) => metric.queryEmbeddingTokens)),
      answerInputTokens: average(metrics.map((metric) => metric.answerInputTokens)),
      answerOutputTokens: average(metrics.map((metric) => metric.answerOutputTokens)),
      estimatedQueryCostUsd: average(metrics.map((metric) => metric.estimatedQueryCostUsd)),
    },
  };
}

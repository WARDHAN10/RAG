import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  calculateAnswerGenerationSummary,
  calculateRetrievalSummary,
  summarizeQueryPerformance,
} from "../src/lib/evaluation";
import type { QueryMetrics } from "../src/lib/rag-core";

type EvaluationCase = {
  id: string;
  category: string;
  question: string;
  expectedFacts: string[];
  relevantChunkIds: string[];
  shouldAbstain: boolean;
};

type AskResponse = {
  status: string;
  answer: string;
  abstained: boolean;
  sources: Array<{
    chunkId: string;
    pointId: string;
    documentId: string;
    documentName: string;
    chunkIndex: number | null;
    rank: number;
    score: number | null;
    text: string;
  }>;
  metrics: QueryMetrics;
};

type CaseObservation = EvaluationCase & {
  expectedRelevantChunkIds: string[];
  answer?: string;
  status?: string;
  abstained?: boolean;
  sources?: AskResponse["sources"];
  metrics?: QueryMetrics;
  error?: string;
};

type CompletedObservation = CaseObservation & {
  answer: string;
  status: string;
  abstained: boolean;
  sources: AskResponse["sources"];
  metrics: QueryMetrics;
};

const repositoryRoot = process.cwd();
const fixturePath = path.join(repositoryRoot, "evals/fixtures/level1-cases.json");
const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as {
  version: number;
  topK: number;
  requiredDocuments: string[];
  cases: EvaluationCase[];
};
const baseUrl = (process.env.EVAL_BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const documentResponse = await fetch(`${baseUrl}/api/documents`, { cache: "no-store" });
if (!documentResponse.ok) {
  throw new Error("Could not verify the indexed fixture documents before evaluation.");
}
const indexedDocuments = (await documentResponse.json()) as { documents?: Array<{ name?: unknown }> };
const indexedDocumentNames = (indexedDocuments.documents ?? [])
  .map((document) => document.name)
  .filter((name): name is string => typeof name === "string")
  .sort();
const requiredDocumentNames = [...fixture.requiredDocuments].sort();
if (JSON.stringify(indexedDocumentNames) !== JSON.stringify(requiredDocumentNames)) {
  throw new Error(
    `Evaluation requires exactly ${requiredDocumentNames.join(" and ")} in the active Qdrant collection. Use Reset index, upload those fixture files, then retry.`,
  );
}
const observations: CaseObservation[] = [];

for (const testCase of fixture.cases) {
  try {
    const response = await fetch(`${baseUrl}/api/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: testCase.question, topK: fixture.topK }),
    });
    const result = (await response.json()) as AskResponse | { error?: string };
    if (!response.ok || !("status" in result)) {
      throw new Error("error" in result ? result.error || `HTTP ${response.status}` : `HTTP ${response.status}`);
    }

    observations.push({
      ...testCase,
      expectedRelevantChunkIds: testCase.relevantChunkIds,
      answer: result.answer,
      status: result.status,
      abstained: result.abstained,
      sources: result.sources,
      metrics: result.metrics,
    });
  } catch (error) {
    observations.push({
      ...testCase,
      expectedRelevantChunkIds: testCase.relevantChunkIds,
      error: error instanceof Error ? error.message : "Evaluation request failed.",
    });
  }
}

const completedObservations = observations.filter(
  (observation): observation is CompletedObservation =>
    typeof observation.answer === "string" &&
    typeof observation.status === "string" &&
    typeof observation.abstained === "boolean" &&
    Array.isArray(observation.sources) &&
    observation.metrics !== undefined,
);
const retrievalSummary = calculateRetrievalSummary(
  completedObservations.map((observation) => ({
    relevantChunkIds: observation.expectedRelevantChunkIds,
    retrievedChunkIds: observation.sources.map((source) => source.chunkId),
  })),
  fixture.topK,
);
const answerGenerationSummary = calculateAnswerGenerationSummary(
  completedObservations.map((observation) => ({
    shouldAbstain: observation.shouldAbstain,
    abstained: observation.abstained,
  })),
);
const performanceSummary = summarizeQueryPerformance(
  completedObservations.map((observation) => observation.metrics),
);

const report = {
  runAt: new Date().toISOString(),
  fixtureVersion: fixture.version,
  baseUrl,
  topK: fixture.topK,
  retrievalEvaluation: {
    metrics: retrievalSummary,
    note: "Only cases with manually labeled relevantChunkIds are included. Recall is macro-averaged across labeled cases.",
  },
  answerGenerationEvaluation: {
    metrics: answerGenerationSummary,
    expectedFactsReview: "Manual review required; answer correctness is not inferred from retrieval labels.",
  },
  performanceSummary,
  cases: observations,
};

function percent(value: number | null) {
  return value === null ? "Unavailable" : `${(value * 100).toFixed(1)}%`;
}

function milliseconds(value: number | null) {
  return value === null ? "Unavailable" : `${value.toFixed(1)} ms`;
}

function averageLatency(key: keyof typeof performanceSummary.latencyMs) {
  return milliseconds(performanceSummary.latencyMs[key].average);
}

function cell(value: string) {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

const caseRows = observations.map((observation) => {
  const retrieved = observation.sources
    ?.map((source) => `#${source.rank} ${source.chunkId}`)
    .join("<br>") || "—";
  const result = observation.error
    ? `ERROR: ${observation.error}`
    : `${observation.status}${observation.abstained ? " (abstained)" : ""}`;
  return `| ${cell(observation.id)} | ${cell(observation.expectedRelevantChunkIds.join(", ") || "Unlabeled")} | ${cell(retrieved)} | ${cell(result)} |`;
}).join("\n");

const markdownReport = `# Level 1 Basic Vector RAG evaluation

- Run: ${report.runAt}
- Fixture version: ${report.fixtureVersion}
- Top K: ${report.topK}
- Completed requests: ${completedObservations.length}/${observations.length}

## Retrieval evaluation

Only cases with manually supplied relevant chunk IDs are scored. The unanswered case is intentionally unlabelled for retrieval metrics. Recall is macro-averaged by question.

- Labeled cases: ${retrievalSummary.retrievalLabeledCases}
- Hit Rate@${fixture.topK}: ${percent(retrievalSummary.hitRateAtK)}
- Recall@${fixture.topK}: ${percent(retrievalSummary.macroRecallAtK)}
- MRR@${fixture.topK}: ${retrievalSummary.meanReciprocalRankAtK === null ? "Unavailable" : retrievalSummary.meanReciprocalRankAtK.toFixed(3)}

## Answer-generation evaluation

- Answer cases: ${answerGenerationSummary.answerCases}
- Abstention accuracy: ${percent(answerGenerationSummary.abstentionAccuracy)}
- Answer facts: manual review against each case's expectedFacts; not part of retrieval scores.

## Average latency

- Query embedding: ${averageLatency("queryEmbedding")}
- Qdrant retrieval: ${averageLatency("vectorSearch")}
- Total retrieval (embedding + Qdrant): ${averageLatency("totalRetrieval")}
- Answer generation: ${averageLatency("answerGeneration")}
- End-to-end server request: ${averageLatency("serverTotal")}

## Per-question retrieval

| Case | Expected relevant chunk IDs | Retrieved chunk IDs in rank order | Answer status |
| --- | --- | --- | --- |
${caseRows}
`;

const resultDirectory = path.join(repositoryRoot, "evals/results");
await mkdir(resultDirectory, { recursive: true });
const timestamp = report.runAt.replace(/[:.]/g, "-");
const reportText = JSON.stringify(report, null, 2) + "\n";
await Promise.all([
  writeFile(path.join(resultDirectory, `run-${timestamp}.json`), reportText, { mode: 0o600 }),
  writeFile(path.join(resultDirectory, "latest.json"), reportText, { mode: 0o600 }),
  writeFile(path.join(resultDirectory, `run-${timestamp}.md`), markdownReport, { mode: 0o600 }),
  writeFile(path.join(resultDirectory, "latest.md"), markdownReport, { mode: 0o600 }),
]);

console.log(markdownReport);
console.log(`Detailed JSON report: evals/results/latest.json`);

if (observations.some((observation) => observation.error)) process.exitCode = 1;

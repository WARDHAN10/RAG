"use client";

import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, DragEvent, FormEvent, ReactNode } from "react";
import type { StoredDocument, VectorHealth } from "@/lib/document-types";
import type { RagResponse } from "@/lib/rag-core";


type VectorMapPoint = {
  id: string;
  documentId: string;
  name: string;
  chunkIndex: number;
  x: number;
  y: number;
};

type UploadProgress = {
  completedFiles: number;
  totalFiles: number;
  indexedFiles: number;
  currentFile: string;
};

type IconName =
  | "sparkles"
  | "chevron"
  | "upload"
  | "file"
  | "database"
  | "check"
  | "plus"
  | "trash"
  | "search"
  | "layers";

const iconContent: Record<IconName, ReactNode> = {
  sparkles: (
    <>
      <path d="m12 3 1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3Z" />
      <path d="m19 15 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z" />
      <path d="m5 2 .6 1.4L7 4l-1.4.6L5 6l-.6-1.4L3 4l1.4-.6L5 2Z" />
    </>
  ),
  chevron: <path d="m9 18 6-6-6-6" />,
  upload: (
    <>
      <path d="M12 16V4" />
      <path d="m7 9 5-5 5 5" />
      <path d="M4 20h16" />
    </>
  ),
  file: (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
      <path d="M14 2v6h6M8 13h8M8 17h8" />
    </>
  ),
  database: (
    <>
      <ellipse cx="12" cy="5" rx="8" ry="3" />
      <path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
    </>
  ),
  check: <path d="m5 12 4 4L19 6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  trash: <path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6m4 4v6m6-6v6" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4" />
    </>
  ),
  layers: (
    <>
      <path d="m12 3 9 5-9 5-9-5 9-5Z" />
      <path d="m3 12 9 5 9-5M3 16l9 5 9-5" />
    </>
  ),
};

function Icon({
  name,
  className = "h-4 w-4",
}: {
  name: IconName;
  className?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {iconContent[name]}
    </svg>
  );
}

function formatMaybeDuration(milliseconds: number | null) {
  return milliseconds === null ? "—" : formatDuration(milliseconds);
}

function formatTokenCount(tokens: number | null) {
  return tokens === null ? "Not reported" : tokens.toLocaleString();
}

function formatTokenPair(inputTokens: number | null, outputTokens: number | null) {
  if (inputTokens === null && outputTokens === null) return "Not reported";
  return `${inputTokens === null ? "—" : inputTokens.toLocaleString()} in / ${outputTokens === null ? "—" : outputTokens.toLocaleString()} out`;
}

function renderAnswerWithCitations(answer: string) {
  return answer.split(/(\[S\d+\])/g).map((part, index) => {
    const citation = part.match(/^\[(S\d+)\]$/)?.[1];
    return citation ? (
      <a key={index} href={"#source-" + citation} className="font-semibold text-[#167d62] underline decoration-[#b8d8c7] underline-offset-2">{part}</a>
    ) : <span key={index}>{part}</span>;
  });
}

function MetricLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-[#f0f2f0] pb-1.5">
      <dt className="text-[#87938c]">{label}</dt>
      <dd className="text-right font-medium text-[#526058]">{value}</dd>
    </div>
  );
}

function vectorColor(documentId: string) {
  const colors = ["#168067", "#5a79c7", "#cf8550", "#8767b3", "#3f9aa1", "#bc617b", "#819743", "#bd9a3e"];
  let hash = 0;
  for (let index = 0; index < documentId.length; index += 1) {
    hash = (hash * 31 + documentId.charCodeAt(index)) | 0;
  }
  return colors[((hash % colors.length) + colors.length) % colors.length];
}

function formatCost(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumSignificantDigits: 3,
  }).format(amount);
}

function formatDuration(milliseconds: number) {
  return milliseconds.toFixed(1) + " ms";
}

function formatSize(bytes: number) {
  if (bytes < 1024) return String(bytes) + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

export default function KnowledgeBase() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [documents, setDocuments] = useState<StoredDocument[]>([]);
  const [health, setHealth] = useState<VectorHealth | null>(null);
  const [connectionState, setConnectionState] = useState<"checking" | "connected" | "setup" | "offline">("checking");
  const [isUploading, setIsUploading] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [isRemovingDocument, setIsRemovingDocument] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [notice, setNotice] = useState("");
  const [noticeIsError, setNoticeIsError] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [vectorMapPoints, setVectorMapPoints] = useState<VectorMapPoint[]>([]);
  const [question, setQuestion] = useState("");
  const [topK, setTopK] = useState(5);
  const [askResult, setAskResult] = useState<RagResponse | null>(null);
  const [askError, setAskError] = useState("");
  const [isAsking, setIsAsking] = useState(false);
  const [vectorMapState, setVectorMapState] = useState<"loading" | "ready" | "unavailable">("loading");

  const chunkCount = documents.reduce((total, document) => total + document.chunkCount, 0);
  const trackedDocuments = documents.filter((document) => document.embeddingTokens !== undefined);
  const embeddingTokens = trackedDocuments.reduce((total, document) => total + (document.embeddingTokens ?? 0), 0);
  const embeddingCostUsd = trackedDocuments.reduce((total, document) => total + (document.embeddingCostUsd ?? 0), 0);
  const averageEmbeddingMs = trackedDocuments.length
    ? trackedDocuments.reduce((total, document) => total + (document.embeddingMs ?? 0), 0) / trackedDocuments.length
    : null;
  const canUpload = Boolean(health?.ready && connectionState === "connected" && !isUploading && !isResetting);
  const vectorStoreValue =
    connectionState === "checking"
      ? "Checking..."
      : connectionState === "connected"
        ? health?.ragMode === "offline" ? "Offline ready" : "Online ready"
        : connectionState === "offline"
          ? "Offline"
          : health?.qdrantConnected
            ? "Provider setup"
            : "Setup needed";
  const vectorStoreDetail =
    connectionState === "connected"
      ? `Qdrant connected · ${health?.providerName} · ${health?.answerModel}`
      : connectionState === "offline"
        ? "Start Qdrant and retry"
        : health?.qdrantConnected
          ? !health.embeddingConfigured
            ? health.providerMessage ?? "Check the selected model provider."
            : health.indexMessage ?? "Check the selected model provider."
          : "Configure .env.local";

  async function refreshVectorMap() {
    setVectorMapState("loading");
    try {
      const response = await fetch("/api/vector-map", { cache: "no-store" });
      if (!response.ok) throw new Error("Could not load the vector map.");
      const result = (await response.json()) as { points: VectorMapPoint[] };
      setVectorMapPoints(result.points);
      setVectorMapState("ready");
    } catch {
      setVectorMapState("unavailable");
    }
  }

  async function handleAsk(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isResetting) return;
    const nextQuestion = question.trim();
    if (!nextQuestion) return;

    setAskError("");
    setAskResult(null);
    setIsAsking(true);
    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: nextQuestion, topK }),
      });
      const payload = (await response.json()) as RagResponse | { error?: string };
      if (!response.ok || !("status" in payload)) {
        throw new Error("error" in payload ? payload.error || "Could not answer this question." : "Could not answer this question.");
      }
      setAskResult(payload);
    } catch (error) {
      setAskError(error instanceof Error ? error.message : "Could not answer this question.");
    } finally {
      setIsAsking(false);
    }
  }

  useEffect(() => {
    let active = true;

    async function loadIndex() {
      try {
        const healthResponse = await fetch("/api/health", { cache: "no-store" });
        if (!healthResponse.ok) throw new Error("Could not read connection status.");
        const nextHealth = (await healthResponse.json()) as VectorHealth;
        if (!active) return;

        setHealth(nextHealth);
        if (nextHealth.ready) setConnectionState("connected");
        else if (!nextHealth.qdrantConfigured || nextHealth.qdrantConnected) setConnectionState("setup");
        else setConnectionState("offline");

        if (nextHealth.qdrantConnected) {
          const documentsResponse = await fetch("/api/documents", { cache: "no-store" });
          if (!documentsResponse.ok) throw new Error("Could not read the document index.");
          const result = (await documentsResponse.json()) as { documents: StoredDocument[] };
          if (active) setDocuments(result.documents);
          if (active) await refreshVectorMap();
        } else if (active) {
          setVectorMapState("unavailable");
        }
      } catch {
        if (active) {
          setConnectionState("offline");
          setVectorMapState("unavailable");
        }
      }
    }

    void loadIndex();
    return () => {
      active = false;
    };
  }, []);

  async function addFiles(files: File[]) {
    if (isUploading || isResetting || files.length === 0) return;

    setNotice("");
    setNoticeIsError(false);

    if (!health?.ready) {
      setNotice(health?.providerMessage ?? health?.indexMessage ?? "Configure Qdrant and the selected model provider before uploading documents.");
      setNoticeIsError(true);
      return;
    }

    setIsUploading(true);
    const accepted: StoredDocument[] = [];
    const rejected: string[] = [];
    let completedFiles = 0;
    setUploadProgress({
      completedFiles,
      totalFiles: files.length,
      indexedFiles: 0,
      currentFile: files[0].name,
    });

    for (const [index, file] of files.entries()) {
      setUploadProgress({
        completedFiles,
        totalFiles: files.length,
        indexedFiles: accepted.length,
        currentFile: file.name,
      });
      if (!/\.(txt|doc|pdf)$/i.test(file.name)) {
        rejected.push(file.name + ": only .txt, .doc, and .pdf files are supported.");
        completedFiles += 1;
        setUploadProgress({
          completedFiles,
          totalFiles: files.length,
          indexedFiles: accepted.length,
          currentFile: files[index + 1]?.name ?? "",
        });
        continue;
      }
      if (file.size > 2 * 1024 * 1024) {
        rejected.push(file.name + ": files must be 2 MB or smaller.");
        completedFiles += 1;
        setUploadProgress({
          completedFiles,
          totalFiles: files.length,
          indexedFiles: accepted.length,
          currentFile: files[index + 1]?.name ?? "",
        });
        continue;
      }

      try {
        const formData = new FormData();
        formData.append("file", file);
        const response = await fetch("/api/documents", {
          method: "POST",
          body: formData,
        });
        const result = (await response.json()) as {
          document?: StoredDocument;
          error?: string;
        };

        if (!response.ok || !result.document) {
          throw new Error(result.error || "Could not index this file.");
        }
        accepted.push(result.document);
      } catch (error) {
        rejected.push(
          file.name + ": " + (error instanceof Error ? error.message : "upload failed."),
        );
      }
      completedFiles += 1;
      setUploadProgress({
        completedFiles,
        totalFiles: files.length,
        indexedFiles: accepted.length,
        currentFile: files[index + 1]?.name ?? "",
      });
    }

    if (accepted.length > 0) {
      setDocuments((current) => [...accepted, ...current]);
      setExpandedId(accepted[0].id);
      void refreshVectorMap();
    }

    if (rejected.length > 0) {
      setNotice(rejected.join(" "));
      setNoticeIsError(true);
    } else if (accepted.length > 0) {
      setNotice(
        String(accepted.length) +
          " " +
          (accepted.length === 1 ? "document was" : "documents were") +
          " saved to Qdrant.",
      );
    }
    setIsUploading(false);
    setUploadProgress(null);
  }

  async function handleInputChange(event: ChangeEvent<HTMLInputElement>) {
    await addFiles(Array.from(event.target.files ?? []));
    event.target.value = "";
  }

  async function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    await addFiles(Array.from(event.dataTransfer.files));
  }

  async function removeDocument(id: string) {
    if (isUploading || isResetting || isAsking || isRemovingDocument) return;
    setNotice("");
    setIsRemovingDocument(true);
    try {
      const response = await fetch("/api/documents/" + encodeURIComponent(id), {
        method: "DELETE",
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error || "Could not remove this document.");

      setDocuments((current) => current.filter((document) => document.id !== id));
      void refreshVectorMap();
      setExpandedId((current) => (current === id ? null : current));
      setNotice("Document removed from Qdrant.");
      setNoticeIsError(false);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not remove this document.");
      setNoticeIsError(true);
    } finally {
      setIsRemovingDocument(false);
    }
  }

  async function resetIndex() {
    if (isUploading || isResetting || isAsking || isRemovingDocument) return;
    const confirmed = window.confirm(
      "Clear every indexed document, chunk, and vector in the configured Qdrant collection? The collection will be recreated for the current embedding dimensions. Original files are not stored, so upload them again to re-index.",
    );
    if (!confirmed) return;

    setIsResetting(true);
    setNotice("");
    setNoticeIsError(false);
    try {
      const response = await fetch("/api/documents", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      const result = (await response.json()) as { reset?: boolean; error?: string };
      if (!response.ok || !result.reset) {
        throw new Error(result.error || "Could not reset the document index.");
      }

      setDocuments([]);
      setVectorMapPoints([]);
      setVectorMapState("ready");
      setHealth((current) => current ? {
        ...current,
        indexedVectorSize: current.vectorSize,
        vectorDimensionsMatch: current.vectorSize === null ? null : true,
        indexMessage: null,
        ready: current.qdrantConnected && current.embeddingConfigured && current.vectorSize !== null,
      } : current);
      setConnectionState(
        health?.qdrantConnected
          ? health.embeddingConfigured && health.vectorSize !== null ? "connected" : "setup"
          : "offline",
      );
      setExpandedId(null);
      setAskResult(null);
      setAskError("");
      setQuestion("");
      setNotice("Index cleared. Upload the files again to re-index them.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not reset the document index.");
      setNoticeIsError(true);
    } finally {
      setIsResetting(false);
    }
  }

  return (
    <div className="min-h-screen lg:flex">
      <aside className="hidden w-[248px] shrink-0 flex-col border-r border-[#e8ece9] bg-white px-5 py-6 lg:flex">
        <a href="#" className="mb-9 flex items-center gap-3 no-underline" aria-label="QuizNest home">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#167d62] text-white shadow-sm">
            <Icon name="sparkles" className="h-5 w-5" />
          </span>
          <span className="text-[17px] font-semibold tracking-[-0.04em] text-[#17251f]">quiznest</span>
        </a>

        <div className="mb-3 px-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#98a29d]">Workspace</div>
        <div className="mb-7 flex items-center justify-between rounded-xl border border-[#e8ece9] px-3 py-3">
          <div className="flex items-center gap-2.5">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-[#f0f5f2] text-[11px] font-semibold text-[#427261]">Q</span>
            <div>
              <p className="text-xs font-semibold text-[#26352e]">My workspace</p>
              <p className="mt-0.5 text-[10px] text-[#8b9690]">Personal</p>
            </div>
          </div>
          <span className="text-[#8b9690]"><Icon name="chevron" className="h-3.5 w-3.5" /></span>
        </div>

        <nav aria-label="Main navigation" className="space-y-1">
          <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#98a29d]">Build</p>
          <div className="flex items-center gap-3 rounded-lg bg-[#eaf5f0] px-3 py-2.5 text-[13px] font-medium text-[#146b54]">
            <Icon name="file" className="h-[17px] w-[17px]" />
            Sources
            <span className="ml-auto h-1.5 w-1.5 rounded-full bg-[#299b77]" />
          </div>
          <a href="#ask" className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] text-[#526058] transition hover:bg-[#f5f8f6]">
            <Icon name="search" className="h-[17px] w-[17px]" />
            Ask documents
            <span className="ml-auto text-[9px] font-medium text-[#43836c]">RAG</span>
          </a>
          <div className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] text-[#8a9690]">
            <Icon name="database" className="h-[17px] w-[17px]" />
            Connections
            <span className="ml-auto text-[9px] font-medium text-[#aab3ae]">SOON</span>
          </div>
        </nav>

        <div className="mt-auto rounded-xl border border-[#e8ece9] bg-[#fafcfb] p-3.5">
          <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold text-[#34443c]">
            <span className="grid h-6 w-6 place-items-center rounded-md bg-[#eaf5f0] text-[#167d62]">
              <Icon name="layers" className="h-3.5 w-3.5" />
            </span>
            Your first index
          </div>
          <p className="text-[11px] leading-[1.55] text-[#7b8881]">
            Upload .txt, .doc, or .pdf files to build your first vector index.
          </p>
          <div className="mt-3 h-1 overflow-hidden rounded-full bg-[#e8ece9]">
            <div className="h-full w-1/3 rounded-full bg-[#299b77]" />
          </div>
          <p className="mt-2 text-[10px] font-medium text-[#89958e]">Step 1 of 3</p>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="flex h-[66px] items-center justify-between border-b border-[#e8ece9] bg-white px-5 sm:px-8">
          <div className="flex items-center gap-2 text-xs text-[#89958e]">
            <span className="font-medium text-[#526058]">My workspace</span>
            <Icon name="chevron" className="h-3 w-3" />
            <span className="text-[#25342d]">Sources</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden rounded-md border border-[#e8ece9] bg-[#fafcfb] px-2.5 py-1.5 text-[10px] font-medium text-[#748078] sm:inline-flex">{connectionState === "checking" ? "Checking services" : health?.modeConfigured ? `${health.ragMode.toUpperCase()} · ${health.providerName}` : "Choose online/offline mode"}</span>
            <span className="grid h-8 w-8 place-items-center rounded-full bg-[#e4f0ea] text-[11px] font-semibold text-[#316a54]">Q</span>
          </div>
        </header>

        <main className="mx-auto max-w-[1240px] px-5 pb-16 pt-8 sm:px-8 sm:pt-10">
          <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="mb-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-[#8a9790]">
                Knowledge setup
                <span className="h-1 w-1 rounded-full bg-[#bdc7c1]" />
                <span className="text-[#37866d]">Level 1 · Basic RAG</span>
              </div>
              <h1 className="text-[27px] font-semibold tracking-[-0.045em] text-[#1a2922] sm:text-[32px]">Your knowledge sources</h1>
              <p className="mt-2 max-w-xl text-[13px] leading-6 text-[#738078]">
                Upload .txt, .doc, or .pdf files. QuizNest extracts text, creates vectors, and stores chunks in Qdrant.
              </p>
            </div>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={!canUpload}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#167d62] px-4 text-xs font-semibold text-white shadow-sm transition hover:bg-[#0e664f] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Icon name="plus" className="h-4 w-4" />
              {isUploading && uploadProgress
                ? `Indexing ${Math.min(uploadProgress.completedFiles + 1, uploadProgress.totalFiles)}/${uploadProgress.totalFiles}`
                : "Add documents"}
            </button>
          </div>

          <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <StatCard label="Documents" value={String(documents.length).padStart(2, "0")} detail="TXT · DOC · PDF" icon="file" />
            <StatCard label="Text chunks" value={String(chunkCount).padStart(2, "0")} detail="Stored in Qdrant" icon="layers" />
            <StatCard label="Embedding tokens" value={trackedDocuments.length ? embeddingTokens.toLocaleString() : "—"} detail={trackedDocuments.length ? String(trackedDocuments.length) + " documents tracked" : "Tracked on new uploads"} icon="layers" />
            <StatCard label="Embedding spend" value={trackedDocuments.length ? formatCost(embeddingCostUsd) : "—"} detail={health?.ragMode === "offline" ? "Local mode · no API charge" : "OpenAI est. · $0.02 / 1M tokens"} icon="database" />
            <StatCard label="Avg. embed time" value={averageEmbeddingMs === null ? "—" : formatDuration(averageEmbeddingMs)} detail={health?.ragMode === "offline" ? "Local model time · not search" : "OpenAI API time · not search"} icon="search" />
            <StatCard label="Vector store" value={vectorStoreValue} detail={vectorStoreDetail} icon="database" muted={connectionState !== "connected"} />
          </div>
          <p className="-mt-3 mb-6 text-[10px] leading-5 text-[#87938c]">Offline embeddings record $0 API spend; local compute and electricity are not priced. Online estimates use $0.02 per 1M tokens. Only recorded indexed uploads are included.</p>

          <section id="ask" className="mb-5 scroll-mt-5 rounded-2xl border border-[#dce9e1] bg-white p-5 shadow-[0_2px_10px_rgba(26,45,35,0.025)] sm:p-6">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-[#25342d]">Ask your documents</h2>
                <p className="mt-1 text-[11px] text-[#87938c]">Answers use retrieved passages and show the sources behind them.</p>
              </div>
              <span className="rounded-md bg-[#eaf5f0] px-2 py-1 text-[10px] font-medium text-[#34785f]">{health?.modeConfigured ? `${health.ragMode.toUpperCase()} · ${health.providerName.toUpperCase()}` : "CHOOSE ONLINE / OFFLINE"}</span>
            </div>

            {documents.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[#dce5df] bg-[#fbfcfb] px-4 py-5 text-xs text-[#87938c]">
                Upload and index a document first. Then you can ask questions about its contents.
              </div>
            ) : (
              <form onSubmit={handleAsk}>
                <label htmlFor="rag-question" className="mb-2 block text-[11px] font-medium text-[#526058]">Your question</label>
                <textarea
                  id="rag-question"
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  maxLength={2000}
                  rows={3}
                  placeholder="Ask something you expect your documents to answer…"
                  className="w-full resize-y rounded-xl border border-[#dfe7e2] bg-[#fcfdfc] px-3.5 py-3 text-[13px] leading-5 text-[#25342d] outline-none transition placeholder:text-[#a0aaa4] focus:border-[#73ad94] focus:ring-2 focus:ring-[#e2f2e9]"
                  disabled={!health?.ready || isAsking}
                />
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <label className="flex items-center gap-2 text-[10px] text-[#849088]" htmlFor="rag-top-k">
                    Chunks to retrieve
                    <select id="rag-top-k" value={topK} onChange={(event) => setTopK(Number(event.target.value))} disabled={isAsking} className="rounded-md border border-[#e1e8e3] bg-white px-2 py-1.5 text-[11px] text-[#526058]">
                      {[3, 5, 8].map((value) => <option key={value} value={value}>{value}</option>)}
                    </select>
                  </label>
                  <button type="submit" disabled={!health?.ready || !question.trim() || isAsking || isResetting} className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#167d62] px-4 text-xs font-semibold text-white transition hover:bg-[#0e664f] disabled:cursor-not-allowed disabled:opacity-50">
                    <Icon name="search" className="h-3.5 w-3.5" />
                    {isAsking ? "Searching documents…" : "Ask question"}
                  </button>
                </div>
              </form>
            )}

            {askError && <p role="alert" className="mt-3 rounded-lg bg-[#fff3f1] px-3 py-2.5 text-xs text-[#a44b45]">{askError}</p>}

            {askResult && (
              <div className="mt-5 border-t border-[#edf0ee] pt-5">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <span className="text-[11px] font-semibold text-[#34443b]">{askResult.status === "answered" ? "Answer" : askResult.status === "insufficient-evidence" ? "Not enough evidence" : askResult.status === "empty" ? "No documents indexed" : "No passages found"}</span>
                  {askResult.abstained && <span className="rounded-md bg-[#fff8ea] px-2 py-1 text-[9px] font-medium text-[#8a7041]">ABSTAINED</span>}
                </div>
                <p className="whitespace-pre-wrap text-[13px] leading-6 text-[#34443b]">{renderAnswerWithCitations(askResult.answer)}</p>

                <div aria-label="Question performance" className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <div className="rounded-lg border border-[#e8ece9] bg-[#fbfcfb] px-3 py-2.5">
                    <p className="text-[9px] font-medium text-[#87938c]">Query embedding</p>
                    <p className="mt-1 text-sm font-semibold text-[#25342d]">{formatMaybeDuration(askResult.metrics.queryEmbeddingMs)}</p>
                  </div>
                  <div className="rounded-lg border border-[#e8ece9] bg-[#fbfcfb] px-3 py-2.5">
                    <p className="text-[9px] font-medium text-[#87938c]">Qdrant retrieval</p>
                    <p className="mt-1 text-sm font-semibold text-[#25342d]">{formatMaybeDuration(askResult.metrics.vectorRetrievalMs)}</p>
                  </div>
                  <div className="rounded-lg border border-[#e8ece9] bg-[#fbfcfb] px-3 py-2.5">
                    <p className="text-[9px] font-medium text-[#87938c]">Total retrieval</p>
                    <p className="mt-1 text-sm font-semibold text-[#25342d]">{formatMaybeDuration(askResult.metrics.totalRetrievalMs)}</p>
                  </div>
                  <div className="rounded-lg border border-[#e8ece9] bg-[#fbfcfb] px-3 py-2.5">
                    <p className="text-[9px] font-medium text-[#87938c]">Answer generation</p>
                    <p className="mt-1 text-sm font-semibold text-[#25342d]">{formatMaybeDuration(askResult.metrics.answerGenerationMs)}</p>
                  </div>
                  <div className="rounded-lg border border-[#e8ece9] bg-[#fbfcfb] px-3 py-2.5">
                    <p className="text-[9px] font-medium text-[#87938c]">End-to-end request</p>
                    <p className="mt-1 text-sm font-semibold text-[#25342d]">{formatDuration(askResult.metrics.totalMs)}</p>
                  </div>
                  <div className="rounded-lg border border-[#e8ece9] bg-[#fbfcfb] px-3 py-2.5">
                    <p className="text-[9px] font-medium text-[#87938c]">Evidence chunks</p>
                    <p className="mt-1 text-sm font-semibold text-[#25342d]">{askResult.metrics.chunksRetrieved}</p>
                  </div>
                </div>

                {askResult.sources.length > 0 && (
                  <div className="mt-5">
                    <h3 className="mb-2 text-[11px] font-semibold text-[#526058]">Retrieved sources</h3>
                    <div className="space-y-2.5">
                      {askResult.sources.map((source) => (
                        <article id={"source-" + source.citationId} key={source.pointId} className="scroll-mt-5 rounded-xl border border-[#e8ece9] bg-[#fbfcfb] p-3.5">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-[#78857d]">
                            <span className="font-semibold text-[#34785f]">[{source.citationId}]</span>
                            <span className="font-medium text-[#526058]">{source.documentName}</span>
                            <span>Chunk {source.chunkIndex ?? "unknown"}</span>
                            <span>Rank {source.rank}</span>
                            <span>Cosine score {source.score === null ? "unavailable" : source.score.toFixed(3)}</span>
                          </div>
                          <p className="mt-1 break-all font-mono text-[9px] text-[#8b9790]">Chunk ID: {source.chunkId}</p>
                          <p className="mt-2 whitespace-pre-wrap text-[11px] leading-5 text-[#68766e]">{source.text}</p>
                        </article>
                      ))}
                    </div>
                    <p className="mt-2 text-[10px] text-[#9aa49e]">Cosine scores are similarity rankings, not calibrated probabilities.</p>
                  </div>
                )}

                <details className="mt-4 rounded-xl border border-[#edf0ee] bg-white px-3.5 py-3">
                  <summary className="cursor-pointer text-[10px] font-semibold text-[#718078]">Query details and cost estimate</summary>
                  <dl className="mt-3 grid gap-x-6 gap-y-2 text-[10px] sm:grid-cols-2 lg:grid-cols-3">
                    <MetricLine label="Qdrant collection check" value={formatMaybeDuration(askResult.metrics.collectionCheckMs)} />
                    <MetricLine label="Query embedding" value={formatMaybeDuration(askResult.metrics.queryEmbeddingMs)} />
                    <MetricLine label="Qdrant vector retrieval" value={formatMaybeDuration(askResult.metrics.vectorRetrievalMs)} />
                    <MetricLine label="Total retrieval (embedding + Qdrant)" value={formatMaybeDuration(askResult.metrics.totalRetrievalMs)} />
                    <MetricLine label="Answer generation" value={formatMaybeDuration(askResult.metrics.answerGenerationMs)} />
                    <MetricLine label="End-to-end server request" value={formatDuration(askResult.metrics.totalMs)} />
                    <MetricLine label="Chunks retrieved" value={String(askResult.metrics.chunksRetrieved)} />
                    <MetricLine label="Query embedding tokens" value={formatTokenCount(askResult.metrics.queryEmbeddingTokens)} />
                    <MetricLine label="Answer input / output tokens" value={formatTokenPair(askResult.metrics.answerInputTokens, askResult.metrics.answerOutputTokens)} />
                    <MetricLine label="Cached answer input tokens" value={formatTokenCount(askResult.metrics.answerCachedInputTokens)} />
                    <MetricLine label="Answer model" value={askResult.metrics.answerModel ?? "Not called"} />
                    <MetricLine label="Estimated query cost" value={askResult.metrics.estimatedQueryCostUsd === null ? "Unavailable" : formatCost(askResult.metrics.estimatedQueryCostUsd)} />
                  </dl>
                  <p className="mt-3 text-[10px] leading-4 text-[#9aa49e]">Total retrieval is query embedding plus Qdrant search; collection check is shown separately. End-to-end server request time excludes browser and network display time. Query cost is separate from indexing spend, uses configured model pricing, and excludes hosting and tax.</p>
                </details>
              </div>
            )}
          </section>

          <section className="mb-5 rounded-2xl border border-[#e6ebe7] bg-white p-5 shadow-[0_2px_10px_rgba(26,45,35,0.025)] sm:p-6">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-[#25342d]">Vector map</h2>
                <p className="mt-1 text-[11px] text-[#87938c]">Each dot is a text chunk, colored by document.</p>
              </div>
              <span className="rounded-md bg-[#f2f6f3] px-2 py-1 text-[10px] font-medium text-[#718078]">2D PCA · UP TO 200 CHUNKS</span>
            </div>
            {vectorMapPoints.length > 0 ? (
              <div>
                <svg viewBox="0 0 100 100" role="img" aria-label="PCA map of document chunk embeddings" className="h-[240px] w-full rounded-xl border border-[#edf0ee] bg-[#fbfcfb]">
                  <path d="M6 50H94M50 6V94" stroke="#e8eeea" strokeWidth="0.35" strokeDasharray="1.5 2" />
                  {vectorMapPoints.map((point) => (
                    <circle key={point.id} cx={point.x} cy={point.y} r="1.5" fill={vectorColor(point.documentId)} fillOpacity="0.82" stroke="white" strokeWidth="0.35">
                      <title>{point.name} · chunk {point.chunkIndex}</title>
                    </circle>
                  ))}
                </svg>
                <p className="mt-2 text-[10px] text-[#9aa49e]">Nearby dots are similar in this 2D projection. This map does not show search speed or retrieval quality.</p>
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
                  {Array.from(new Map(vectorMapPoints.map((point) => [point.documentId, point.name])).entries()).slice(0, 6).map(([documentId, name]) => (
                    <span key={documentId} className="inline-flex items-center gap-1.5 text-[10px] text-[#748078]">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: vectorColor(documentId) }} />
                      <span className="max-w-[180px] truncate">{name}</span>
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              <div className="grid min-h-[150px] place-items-center rounded-xl border border-dashed border-[#dce5df] bg-[#fbfcfb] text-center">
                <p className="text-xs text-[#87938c]">{vectorMapState === "loading" ? "Loading stored vectors…" : vectorMapState === "unavailable" ? "Vector map is unavailable. Check the Qdrant connection." : "Upload a document to map its chunk vectors."}</p>
              </div>
            )}
          </section>

          {connectionState !== "checking" && connectionState !== "connected" && (
            <div className="mb-5 rounded-xl border border-[#eadfc6] bg-[#fffaf0] px-4 py-3.5">
              <p className="text-xs font-semibold text-[#695a3f]">{health?.qdrantConnected ? "Finish model or index setup to upload" : "Finish the database setup to upload"}</p>
              <p className="mt-1 text-[11px] leading-5 text-[#887a5f]">
                {connectionState === "offline"
                  ? "Qdrant is configured but unreachable. Run docker compose up -d and check QDRANT_URL."
                  : health?.qdrantConnected
                    ? health.providerMessage ?? health.indexMessage ?? "Check the selected provider settings in .env.local."
                    : "Copy .env.example to .env.local, choose RAG_MODE, run docker compose up -d, then start QuizNest."}
              </p>
            </div>
          )}

          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(280px,0.75fr)]">
            <section className="rounded-2xl border border-[#e6ebe7] bg-white p-5 shadow-[0_2px_10px_rgba(26,45,35,0.025)] sm:p-6">
              <div className="mb-5 flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-sm font-semibold text-[#25342d]">Add documents</h2>
                  <p className="mt-1 text-xs text-[#849088]">Upload .txt, .doc, or .pdf files or drop them below.</p>
                </div>
                <span className="rounded-md bg-[#f2f6f3] px-2 py-1 text-[10px] font-medium text-[#718078]">TXT · DOC · PDF</span>
              </div>

              <input
                ref={inputRef}
                type="file"
                accept=".txt,.doc,.pdf,text/plain,application/msword,application/pdf"
                multiple
                onChange={handleInputChange}
                className="sr-only"
                aria-label="Choose TXT, DOC, or PDF files"
              />

              <div
                onDragEnter={(event) => { event.preventDefault(); setIsDragging(true); }}
                onDragOver={(event) => event.preventDefault()}
                onDragLeave={(event) => {
                  if (event.currentTarget === event.target) setIsDragging(false);
                }}
                onDrop={handleDrop}
                className={
                  "flex min-h-[220px] flex-col items-center justify-center rounded-xl border border-dashed px-5 py-8 text-center transition " +
                  (isDragging
                    ? "border-[#35a77f] bg-[#f0faf5]"
                    : "border-[#cfd9d2] bg-[#fbfcfb] hover:border-[#8fbaa8] hover:bg-[#f8fbf9]")
                }
              >
                <span className="mb-3 grid h-11 w-11 place-items-center rounded-xl border border-[#e6ebe7] bg-white text-[#39836a] shadow-[0_2px_5px_rgba(21,57,39,0.04)]">
                  <Icon name="upload" className="h-5 w-5" />
                </span>
                <p className="text-[13px] font-semibold text-[#34443b]">Drop your files here</p>
                <p className="mt-1.5 text-xs text-[#89958e]">or choose files from your device</p>
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  disabled={!canUpload}
                  className="mt-4 rounded-lg border border-[#dfe6e1] bg-white px-3.5 py-2 text-[11px] font-semibold text-[#415249] shadow-[0_1px_2px_rgba(20,40,29,0.03)] transition hover:border-[#b8c9bf] hover:bg-[#fbfdfb] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isUploading && uploadProgress
                    ? `Indexing ${Math.min(uploadProgress.completedFiles + 1, uploadProgress.totalFiles)}/${uploadProgress.totalFiles}`
                    : "Browse files"}
                </button>
                <p className="mt-3 text-[10px] text-[#a0aaa4]">Up to 2 MB · Scanned PDFs need OCR</p>
              </div>

              {uploadProgress && (
                <div role="status" aria-live="polite" className="mt-4 rounded-xl border border-[#dce9e1] bg-[#f7fbf8] px-3.5 py-3">
                  <div className="flex items-center justify-between gap-3 text-[10px]">
                    <span className="font-semibold text-[#415249]">
                      {uploadProgress.completedFiles} of {uploadProgress.totalFiles} files processed
                    </span>
                    <span className="text-[#718078]">{uploadProgress.indexedFiles} indexed</span>
                  </div>
                  <div
                    role="progressbar"
                    aria-label="File indexing progress"
                    aria-valuemin={0}
                    aria-valuemax={uploadProgress.totalFiles}
                    aria-valuenow={uploadProgress.completedFiles}
                    className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#e5eee8]"
                  >
                    <div
                      className="h-full rounded-full bg-[#299b77] transition-[width] duration-300"
                      style={{ width: `${(uploadProgress.completedFiles / uploadProgress.totalFiles) * 100}%` }}
                    />
                  </div>
                  <p className="mt-2 flex items-center gap-2 text-[10px] text-[#718078]">
                    {uploadProgress.currentFile ? (
                      <>
                        <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-[#d8e7de] border-t-[#167d62]" />
                        <span className="truncate">Indexing {uploadProgress.currentFile}</span>
                      </>
                    ) : (
                      "Finishing up…"
                    )}
                  </p>
                </div>
              )}

              {notice && (
                <p role="status" className={"mt-3 text-xs " + (noticeIsError ? "text-[#a44b45]" : "text-[#24775c]")}>
                  {notice}
                </p>
              )}
            </section>

            <section className="rounded-2xl border border-[#e6ebe7] bg-white p-5 shadow-[0_2px_10px_rgba(26,45,35,0.025)] sm:p-6">
              <div className="mb-5 flex items-center gap-2.5">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#eaf5f0] text-[#167d62]">
                  <Icon name="layers" className="h-4 w-4" />
                </span>
                <div>
                  <h2 className="text-sm font-semibold text-[#25342d]">Ingestion flow</h2>
                  <p className="mt-0.5 text-[10px] text-[#87938c]">What happens to your content</p>
                </div>
              </div>
              <FlowStep number="01" title="Upload a document" description="The file is sent to the QuizNest server for indexing." state={documents.length ? "complete" : "active"} />
              <FlowStep number="02" title="Chunk and embed" description={health ? `${health.providerName} · ${health.embeddingModel} · ${health.vectorSize ?? "?"} dimensions` : "The selected provider creates vectors for each chunk."} state={documents.length ? "complete" : health?.embeddingConfigured ? "active" : "pending"} />
              <FlowStep number="03" title="Store in Qdrant" description="Chunks, vectors, and document details persist in your collection." state={documents.length ? "complete" : health?.qdrantConnected ? "active" : "pending"} last />
              <div className="mt-4 rounded-lg bg-[#f7f9f7] px-3 py-2.5 text-[10px] leading-[1.55] text-[#829087]">
                {health?.ragMode === "offline" ? "Text is processed by local Ollama models. The original file is not retained separately." : "Text is sent to OpenAI for embeddings. The original file is not retained separately."}
              </div>
            </section>
          </div>

          <section className="mt-6 overflow-hidden rounded-2xl border border-[#e6ebe7] bg-white shadow-[0_2px_10px_rgba(26,45,35,0.025)]">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#edf0ee] px-5 py-4 sm:px-6">
              <div>
                <h2 className="text-sm font-semibold text-[#25342d]">Document library</h2>
                <p className="mt-1 text-[11px] text-[#87938c]">
                  {documents.length ? String(documents.length) + " " + (documents.length === 1 ? "document" : "documents") + " indexed in Qdrant" : "Files you add will appear here"}
                </p>
              </div>
              {(documents.length > 0 || health?.qdrantConnected) && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={resetIndex}
                    disabled={isResetting || isUploading || isAsking || isRemovingDocument}
                    className="rounded-md border border-[#ead8d5] px-2.5 py-1.5 text-[10px] font-medium text-[#a44b45] transition hover:bg-[#fff5f3] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isResetting ? "Resetting index…" : "Reset index"}
                  </button>
                  {documents.length > 0 && (
                    <span className="rounded-md bg-[#eaf5f0] px-2 py-1 text-[10px] font-medium text-[#34785f]">Persisted</span>
                  )}
                </div>
              )}
            </div>

            {documents.length === 0 ? (
              <div className="flex flex-col items-center px-5 py-10 text-center">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#f4f7f5] text-[#91a098]">
                  <Icon name="file" className="h-[18px] w-[18px]" />
                </span>
                <p className="mt-3 text-xs font-semibold text-[#536158]">No documents yet</p>
                <p className="mt-1 text-[11px] text-[#98a29c]">Upload a .txt, .doc, or .pdf file to index its chunks.</p>
              </div>
            ) : (
              <div className="divide-y divide-[#edf0ee]">
                {documents.map((document) => {
                  const isExpanded = expandedId === document.id;
                  return (
                    <div key={document.id}>
                      <div className="flex items-center gap-3 px-5 py-3.5 sm:px-6">
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#f1f6f3] text-[#4d8b70]">
                          <Icon name="file" className="h-[17px] w-[17px]" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-semibold text-[#35443b]">{document.name}</p>
                          <p className="mt-1 text-[10px] text-[#929d96]">{formatSize(document.bytes)} <span className="mx-1.5 text-[#c1cac4]">·</span>{document.characters.toLocaleString()} characters</p>
                        </div>
                        <span className="hidden rounded-md bg-[#f4f7f5] px-2 py-1 text-[10px] font-medium text-[#6f7e75] sm:inline-block">
                          {document.chunkCount} {document.chunkCount === 1 ? "chunk" : "chunks"}
                        </span>
                        <button
                          type="button"
                          onClick={() => setExpandedId(isExpanded ? null : document.id)}
                          aria-expanded={isExpanded}
                          className="grid h-8 w-8 place-items-center rounded-lg text-[#859189] transition hover:bg-[#f4f7f5] hover:text-[#3c5949]"
                          aria-label={(isExpanded ? "Hide" : "Show") + " chunks for " + document.name}
                        >
                          <Icon name="chevron" className={"h-4 w-4 transition-transform " + (isExpanded ? "rotate-90" : "")} />
                        </button>
                        <button
                          type="button"
                          onClick={() => void removeDocument(document.id)}
                          disabled={isRemovingDocument || isResetting || isUploading || isAsking}
                          className="grid h-8 w-8 place-items-center rounded-lg text-[#a2aca6] transition hover:bg-[#fff4f2] hover:text-[#b34d45]"
                          aria-label={"Remove " + document.name}
                        >
                          <Icon name="trash" className="h-4 w-4" />
                        </button>
                      </div>
                      {isExpanded && (
                        <div className="space-y-2.5 bg-[#fbfcfb] px-5 pb-4 pl-[68px] sm:px-6 sm:pl-[83px]">
                          {document.previewChunks.map((chunk) => (
                            <article key={chunk.index} className="rounded-lg border border-[#e9eeea] bg-white p-3">
                              <div className="mb-1.5 flex items-center justify-between">
                                <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-[#87958c]">Chunk {String(chunk.index).padStart(2, "0")}</span>
                                <span className="text-[9px] text-[#a0aaa4]">{chunk.text.length} characters</span>
                              </div>
                              <p className="whitespace-pre-wrap break-words text-[11px] leading-[1.65] text-[#637169]">{chunk.text}</p>
                            </article>
                          ))}
                          {document.chunkCount > document.previewChunks.length && (
                            <p className="px-1 text-[10px] text-[#88948d]">And {document.chunkCount - document.previewChunks.length} more chunks</p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <p className="mt-5 text-center text-[10px] text-[#a2aca6]">
            {health?.ragMode === "offline" ? "Local Ollama inference · no model API calls" : "Online OpenAI inference"} · <span className="font-medium text-[#718078]">chunks and vectors live in Qdrant</span>
          </p>
        </main>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  detail,
  icon,
  muted = false,
}: {
  label: string;
  value: string;
  detail: string;
  icon: IconName;
  muted?: boolean;
}) {
  return (
    <div className="rounded-xl border border-[#e6ebe7] bg-white px-4 py-3.5 shadow-[0_2px_10px_rgba(26,45,35,0.02)]">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-[#78857d]">{label}</span>
        <Icon name={icon} className={"h-4 w-4 " + (muted ? "text-[#a8b2ac]" : "text-[#83a794]")} />
      </div>
      <p className={"mt-2 text-[18px] font-semibold tracking-[-0.04em] " + (muted ? "text-[#7a8780]" : "text-[#26362e]")}>{value}</p>
      <p className="mt-1 text-[10px] text-[#9aa49e]">{detail}</p>
    </div>
  );
}

function FlowStep({
  number,
  title,
  description,
  state,
  last = false,
}: {
  number: string;
  title: string;
  description: string;
  state: "complete" | "active" | "pending";
  last?: boolean;
}) {
  const stateClass =
    state === "complete"
      ? "border-[#cce7d9] bg-[#eaf5f0] text-[#278061]"
      : state === "active"
        ? "border-[#9cccb5] bg-white text-[#318364]"
        : "border-[#e5eae6] bg-white text-[#a1aba5]";
  const titleClass = state === "pending" ? "text-[#8f9a93]" : "text-[#46554c]";

  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <span className={"grid h-7 w-7 shrink-0 place-items-center rounded-full border text-[9px] font-semibold " + stateClass}>
          {state === "complete" ? <Icon name="check" className="h-3.5 w-3.5" /> : number}
        </span>
        {!last && <span className="my-1 min-h-5 w-px flex-1 bg-[#e8eeea]" />}
      </div>
      <div className={(last ? "pb-0" : "pb-4") + " pt-0.5"}>
        <p className={"text-[11px] font-semibold " + titleClass}>{title}</p>
        <p className="mt-1 text-[10px] leading-[1.55] text-[#909c94]">{description}</p>
      </div>
    </div>
  );
}

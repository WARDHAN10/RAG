# QuizNest

QuizNest is a small Next.js application for uploading documents to Qdrant and asking questions grounded in their contents. This repository implements **Level 1: Basic Vector RAG**.

## Architecture

The app keeps the existing upload and indexing flow:

1. Upload a `.txt`, legacy `.doc`, or text-based `.pdf` file.
2. Extract and split text locally. Create vectors with the provider selected by `RAG_MODE`: OpenAI in `online` mode or local Ollama in `offline` mode.
3. Store vectors and chunk metadata in the configured Qdrant collection. The original file is not retained separately.

The question flow is:

`question → query embedding → Qdrant vector search → bounded evidence → grounded answer → source citations`

`POST /api/ask` accepts a question and optional `topK` (default 5, maximum 8). The query uses the same embedding provider and model configuration as ingestion: `text-embedding-3-small` online, or the configured Ollama embedding model offline. Qdrant returns the top matching chunks with a stable chunk ID, document name, rank, text, and similarity score; the selected local or online chat model then produces a structured, evidence-based answer. Citation IDs are checked against the retrieved chunks before returning the response. If there are no indexed chunks, no readable results, or no valid supporting citation, the API returns a clear empty or abstention state.

Document passages are treated as untrusted evidence in the answer prompt, and the context is limited to 10,000 characters. Qdrant similarity scores are rankings, not calibrated probabilities. The UI shows the answer, clickable citations, source passages, and per-query details.

## Setup

1. Copy `.env.example` to `.env.local`. The example selects `RAG_MODE=offline` to avoid model API charges.
2. Start Qdrant: `docker compose up -d`.
3. For offline mode, install [Ollama](https://ollama.com/download) and download the small demo models once:

   ```sh
   ollama pull all-minilm
   ollama pull qwen3:0.6b
   ```

   The Ollama library lists these models at about 46 MB and 523 MB, respectively. After they are downloaded, inference uses the local Ollama service at `http://127.0.0.1:11434` and makes no OpenAI calls.
4. Install packages: `npm install`.
5. Start QuizNest: `npm run dev`.
6. Open <http://localhost:3000>. The dashboard shows the active mode and whether its models are ready.

For online mode, set `RAG_MODE=online` and add `OPENAI_API_KEY` in `.env.local`. Online mode uses OpenAI for embeddings and answer generation. Change the environment setting before starting QuizNest; then use **Reset index** and re-upload documents when changing embedding modes.

Environment variables:

| Variable | Required | Purpose |
| --- | --- | --- |
| `RAG_MODE` | Yes | `offline` for local Ollama, or `online` for OpenAI. No provider is called until this is explicitly set. |
| `OLLAMA_BASE_URL` | Offline | Local Ollama URL; defaults to `http://127.0.0.1:11434`. |
| `OLLAMA_EMBEDDING_MODEL` | Offline | Defaults to `all-minilm` (384 dimensions). |
| `OLLAMA_CHAT_MODEL` | Offline | Defaults to `qwen3:0.6b`; a larger local model can be selected here. |
| `EMBEDDING_DIMENSIONS` | No | Optional dimension override; defaults to 384 offline and 1536 online. |
| `OPENAI_API_KEY` | Online | Server-side API key for embeddings and answer generation. |
| `OPENAI_CHAT_MODEL` | Online | Answer model; defaults to `gpt-5.4-mini`. |
| `QDRANT_URL` | Yes | Qdrant endpoint; local Docker uses `http://127.0.0.1:6333`. |
| `QDRANT_API_KEY` | No | Authentication for a remote Qdrant instance. |
| `QDRANT_COLLECTION` | No | Collection name; defaults to `quiznest_documents`. |

Never put real credentials in `.env.example` or browser code. Ollama models must be downloaded once before using offline mode; the default local URL keeps document processing on your machine. Local inference has no model API charge, but it still uses your computer's memory, processor/GPU, electricity, and time. The local Compose setup binds Qdrant to loopback and persists data in the `qdrant_data` volume.

## Upload and ask

Use the dashboard's **Add documents** action, then ask a question in **Ask your documents**. Retrieved chunks show their document, chunk ID, rank, similarity score, and text. For a command-line upload, for example:

```sh
curl -F 'file=@path/to/handbook.txt' http://localhost:3000/api/documents
```

Ask a question with the default top 5 results:

```sh
curl -H 'Content-Type: application/json' \
  -d '{"question":"When should the on-call manager be notified?"}' \
  http://localhost:3000/api/ask
```

The upload limit is 2 MB per file. `.doc` support is for legacy Word files. PDFs need selectable text; scanned PDFs require OCR, which is not included. Delete one document from the dashboard to remove its chunks and vectors. Use **Reset index** in the document library to clear and recreate the configured Qdrant collection before trying another dataset or embedding configuration; the original files are not retained, so upload them again to re-index.

## Measurements and evaluation

The answer panel shows query-embedding, Qdrant-search, total-retrieval, answer-generation, and end-to-end server request latency in milliseconds. Details also include collection-check time, token counts, answer model, and estimated per-query cost. Total retrieval is query embedding plus Qdrant search; the collection check is separate. In offline mode, estimated API spend is $0; local compute and electricity are not priced. Server request time excludes browser and network display time. Online query estimates include embedding and answer tokens, are separate from indexing cost, and exclude hosting and tax. Pricing assumptions live in `src/lib/openai-pricing.ts` and should be checked against current provider rates. Missing usage is shown as unavailable, not fabricated.

Run automated tests with:

```sh
npm test
```

The unit tests mock embedding and Qdrant responses and need no live credentials. To run the repeatable live evaluation:

1. Keep QuizNest running with its configured model provider and Qdrant.
2. The evaluation expects exactly the two fixture documents below in the active collection. **Reset index clears every document in that collection.** Save anything you need, then use Reset index and upload both fixture files with their original filenames:

   ```sh
   curl -F 'file=@evals/fixtures/documents/sample-employee-guide.txt' http://localhost:3000/api/documents
   curl -F 'file=@evals/fixtures/documents/sample-technical-runbook.txt' http://localhost:3000/api/documents
   ```

3. Run `npm run eval`. It checks the active document names before sending any questions, and refuses to score a different dataset.

The small synthetic question set and its manually assigned `relevantChunkIds` are in `evals/fixtures/level1-cases.json`. The IDs are based on source filename, chunk index, and a short text hash so labels remain stable across re-indexing but change when chunk contents change. The unanswered test case has no retrieval relevance label and is excluded from retrieval metrics; its abstention behavior is assessed separately. Extend the fixture only after inspecting the document chunks and manually confirming their relevance. Reports are written to `evals/results/` (ignored by Git, with local files restricted to the current user): `latest.md` is the readable report and `latest.json` contains full case detail. Retrieval Hit Rate@K, macro Recall@K, and MRR@K are kept separate from answer-generation abstention accuracy and manual expected-fact review. Reports also include query embedding, Qdrant, total retrieval, answer-generation, and end-to-end request average/median/P95 latency. P95 from this small starter fixture is only a rough demo statistic; collect more representative queries for stable latency percentiles. Set `EVAL_BASE_URL` to use a different local app URL.

The live harness is also the manual end-to-end verification procedure: upload the fixtures, run the same fixed questions, and inspect both the saved report and the dashboard's sources/metrics.

## Security and current limits

The API key stays server-side, user inputs are bounded, the collection is selected only through server configuration, and document contents and questions are not logged by the RAG path. This baseline has **no sign-in, authorization, or tenant isolation**: dashboard/API users share the configured Qdrant collection, and document IDs are not ownership checks. Use it only in a trusted local environment until access control is added; do not expose it as a multi-user service for private documents.

This level deliberately does not include hybrid/exact-term search, reranking, query rewriting, advanced metadata filters or sensitive-document controls, multi-tenant authorization, OCR, or agentic retrieval. Those belong in later levels.

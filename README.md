# QuizNest

A small Next.js project for building a document-backed assistant in incremental RAG levels.

## Current slice

Upload .txt, legacy Word .doc, or text-based .pdf files. QuizNest extracts the text, chunks it, creates embeddings, and stores each chunk and vector in Qdrant. The original file is not retained separately. OpenAI is used only on the server to create embeddings; its API key is never sent to the browser.

## Run locally

1. Copy .env.example to .env.local.
2. Add your OPENAI_API_KEY to .env.local.
3. Start Qdrant with: docker compose up -d.
4. Install app packages with: npm install.
5. Start QuizNest with: npm run dev.
6. Open http://localhost:3000.

Qdrant data persists in the qdrant_data Docker volume. The local compose service binds its API to 127.0.0.1.

## Notes

- The upload path accepts .txt, .doc, and .pdf files up to 2 MB. PDFs must contain selectable text; scanned PDFs need OCR, which is not included yet. Word support is for legacy .doc files.
- Text is sent to OpenAI to create embeddings. Chunks, metadata, and vectors are stored in Qdrant. The dashboard tracks reported embedding tokens, estimated embedding spend, and embedding API time for new uploads; it does not yet measure search or answer-generation costs.
- QDRANT_URL, QDRANT_API_KEY, QDRANT_COLLECTION and OPENAI_API_KEY are server-side environment variables. Embeddings use text-embedding-3-small.
- Database source connectors and chat/retrieval are not part of this slice yet.

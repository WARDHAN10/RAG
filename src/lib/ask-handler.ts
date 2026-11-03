import { AskInputError, validateAskInput } from "./rag-core";
import { RagPipelineError, runBasicRag, type RagDependencies } from "./rag-service";

const MAX_REQUEST_BYTES = 16 * 1024;

class RequestTooLargeError extends Error {}

async function readJsonRequest(request: Request) {
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    throw new RequestTooLargeError();
  }

  if (!request.body) throw new SyntaxError("Missing request body.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_REQUEST_BYTES) {
      await reader.cancel();
      throw new RequestTooLargeError();
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

function errorResponse(error: unknown) {
  if (error instanceof AskInputError) {
    return Response.json({ error: error.message }, { status: 400 });
  }
  if (error instanceof RagPipelineError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  return Response.json({ error: "The question could not be processed. Please try again." }, { status: 500 });
}

export async function handleAskRequest(request: Request, dependencies: RagDependencies) {
  const requestStartedAt = (dependencies.now ?? (() => performance.now()))();
  let body: unknown;

  try {
    body = await readJsonRequest(request);
  } catch (error) {
    if (error instanceof RequestTooLargeError) {
      return Response.json({ error: "The request is too large." }, { status: 413 });
    }
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  let input;
  try {
    input = validateAskInput(body);
  } catch (error) {
    return errorResponse(error);
  }

  try {
    const result = await runBasicRag(input, dependencies, requestStartedAt);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

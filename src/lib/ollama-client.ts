export function getOllamaBaseUrl() {
  return (process.env.OLLAMA_BASE_URL?.trim() || "http://127.0.0.1:11434").replace(/\/$/, "");
}

export async function getOllamaModels(timeoutMs = 1500) {
  const response = await fetch(`${getOllamaBaseUrl()}/api/tags`, {
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("The local model service did not respond.");
  return (await response.json()) as { models?: Array<{ name?: string; model?: string }> };
}

export async function postOllamaJson<T>(path: string, body: unknown, timeoutMs = 180_000) {
  const response = await fetch(`${getOllamaBaseUrl()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("The local model request failed.");
  return (await response.json()) as T;
}

import { isOpenAIConfigured } from "./openai-client";
import { getOllamaModels } from "./ollama-client";
import { DEFAULT_CHAT_MODEL, EMBEDDING_MODEL } from "./openai-pricing";

export type RagMode = "offline" | "online";

export function getRagMode(): RagMode {
  return process.env.RAG_MODE?.trim().toLowerCase() === "online" ? "online" : "offline";
}

export function getRagModeConfigurationError() {
  const mode = process.env.RAG_MODE?.trim().toLowerCase();
  return mode === "online" || mode === "offline"
    ? null
    : "Set RAG_MODE=offline or RAG_MODE=online in .env.local before using QuizNest.";
}

export function getEmbeddingModel() {
  return getRagMode() === "offline"
    ? process.env.OLLAMA_EMBEDDING_MODEL?.trim() || "all-minilm"
    : EMBEDDING_MODEL;
}

export function getAnswerModel() {
  return getRagMode() === "offline"
    ? process.env.OLLAMA_CHAT_MODEL?.trim() || "qwen3:0.6b"
    : process.env.OPENAI_CHAT_MODEL?.trim() || DEFAULT_CHAT_MODEL;
}

export function getVectorSize() {
  const configured = process.env.EMBEDDING_DIMENSIONS?.trim();
  if (!configured) return getRagMode() === "offline" ? 384 : 1536;
  const size = Number(configured);
  if (!Number.isInteger(size) || size < 1 || size > 8192) {
    throw new Error("EMBEDDING_DIMENSIONS must be a whole number between 1 and 8192.");
  }
  return size;
}

export function isRagProviderConfigured() {
  if (getRagModeConfigurationError()) return false;
  try {
    getVectorSize();
  } catch {
    return false;
  }
  return getRagMode() === "offline" || isOpenAIConfigured();
}

export function getRagProviderConfigurationMessage() {
  const modeError = getRagModeConfigurationError();
  if (modeError) return modeError;
  try {
    getVectorSize();
  } catch (error) {
    return error instanceof Error ? error.message : "Check EMBEDDING_DIMENSIONS in .env.local.";
  }
  if (getRagMode() === "online" && !isOpenAIConfigured()) {
    return "OPENAI_API_KEY is missing. Add it to .env.local for online mode.";
  }
  return "The selected model provider is not configured.";
}

function canonicalModelName(value: string) {
  const name = value.trim().toLowerCase();
  return name.includes(":") ? name : `${name}:latest`;
}

export async function getRagProviderHealth() {
  const mode = getRagMode();
  const embeddingModel = getEmbeddingModel();
  const answerModel = getAnswerModel();
  const modeError = getRagModeConfigurationError();
  let vectorSize: number | null = null;
  let dimensionError: string | null = null;
  try {
    vectorSize = getVectorSize();
  } catch (error) {
    dimensionError = error instanceof Error ? error.message : "Check EMBEDDING_DIMENSIONS.";
  }

  if (modeError || dimensionError) {
    return {
      mode,
      modeConfigured: false,
      providerName: mode === "offline" ? "Ollama" : "OpenAI",
      embeddingModel,
      answerModel,
      vectorSize,
      providerReady: false,
      providerConnected: false,
      providerMessage: modeError ?? dimensionError,
    };
  }

  if (mode === "online") {
    const configured = isOpenAIConfigured();
    return {
      mode,
      modeConfigured: true,
      providerName: "OpenAI",
      embeddingModel,
      answerModel,
      vectorSize,
      providerReady: configured,
      providerConnected: configured,
      providerMessage: configured ? null : "Set OPENAI_API_KEY in .env.local for online mode.",
    };
  }

  try {
    const response = await getOllamaModels();
    const installedModels = new Set(
      (response.models ?? [])
        .flatMap((model) => [model.name, model.model])
        .filter((name): name is string => typeof name === "string")
        .map(canonicalModelName),
    );
    const missing = [embeddingModel, answerModel].filter(
      (model) => !installedModels.has(canonicalModelName(model)),
    );
    return {
      mode,
      modeConfigured: true,
      providerName: "Ollama",
      embeddingModel,
      answerModel,
      vectorSize,
      providerReady: missing.length === 0,
      providerConnected: true,
      providerMessage: missing.length
        ? `Pull the configured local models first: ${missing.map((model) => `ollama pull ${model}`).join(" and ")}.`
        : null,
    };
  } catch {
    return {
      mode,
      modeConfigured: true,
      providerName: "Ollama",
      embeddingModel,
      answerModel,
      vectorSize,
      providerReady: false,
      providerConnected: false,
      providerMessage: "Ollama is not reachable. Start the local Ollama app and check OLLAMA_BASE_URL.",
    };
  }
}

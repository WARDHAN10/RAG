import OpenAI from "openai";

let client: OpenAI | undefined;

export function isOpenAIConfigured() {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

export function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured.");
  if (!client) client = new OpenAI({ apiKey });
  return client;
}

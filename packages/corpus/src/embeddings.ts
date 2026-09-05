import { EMBEDDING_DIMENSIONS } from "@wiki/db/schema";

const EMBEDDINGS_URL = "https://openrouter.ai/api/v1/embeddings";

/**
 * Turns text into vectors for the Corpus.
 *
 * The model is part of the interface because vectors are only comparable to
 * others from the same model: retrieval embeds the question with whatever built
 * the Corpus, and a mismatch degrades results silently instead of failing.
 */
export interface Embedder {
  model: string;
  embed(texts: string[]): Promise<number[][]>;
}

interface EmbeddingsResponse {
  data?: Array<{ embedding: number[]; index: number }>;
  error?: { message?: string };
}

/** Embeds through OpenRouter, batching every text into one request. */
export function openRouterEmbedder(config: { apiKey: string; model: string }): Embedder {
  const { apiKey, model } = config;
  return {
    model,
    async embed(texts) {
      if (texts.length === 0) {
        return [];
      }

      const response = await fetch(EMBEDDINGS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model, input: texts, dimensions: EMBEDDING_DIMENSIONS }),
      });

      if (!response.ok) {
        throw new Error(`OpenRouter returned ${response.status}: ${await response.text()}`);
      }

      const body = (await response.json()) as EmbeddingsResponse;
      if (body.error || !body.data) {
        throw new Error(`OpenRouter failed to embed: ${body.error?.message ?? "no data"}`);
      }

      // OpenRouter does not promise the vectors come back in the order sent.
      const ordered = [...body.data].sort((left, right) => left.index - right.index);
      if (ordered.length !== texts.length) {
        throw new Error(`OpenRouter embedded ${ordered.length} of ${texts.length} Chunks`);
      }

      return ordered.map((item) => item.embedding);
    },
  };
}

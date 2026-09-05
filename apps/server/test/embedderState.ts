/** Overrides for question embeddings in chat tests that need retrieval to rank. */
export const embedByText: Record<string, number[]> = {};

export function resetEmbedByText() {
  for (const key of Object.keys(embedByText)) {
    delete embedByText[key];
  }
}

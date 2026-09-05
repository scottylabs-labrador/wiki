---
status: accepted
---

# Retrieve Chunks rather than stuffing the whole Corpus

The wiki agent retrieves the Chunks most similar to a question from pgvector instead of putting the entire Corpus into every prompt.

This is a deliberate deviation from what the numbers alone would justify, and a reader who measures the Corpus will otherwise assume it was an oversight. As of September 2026 the Corpus is 27 Pages totalling 23,990 bytes, roughly 6,000 tokens, against a 1,310,720-token context window on `~deepseek/deepseek-v4-flash-latest`. Sending all of it costs about $0.0005 per question. Prompt stuffing was measured, costed, and recommended; retrieval was chosen anyway, so that the committee has the infrastructure in place before the Corpus grows and so that members learn to build one.

## Consequences

- pgvector, an embeddings provider, a chunking strategy, and a similarity threshold all become part of the system, none of which prompt stuffing would need.
- A follow-up question needs an extra LLM call to rewrite it into a standalone query before retrieval, adding a round trip to time-to-first-token on non-first turns.
- Retrieval can only lose information the model would otherwise have seen. Recall problems that a stuffed prompt cannot have are now possible, which is what the threshold in ADR-0002 exists to detect.
- No vector index is built. At roughly 60-100 Chunks a sequential scan beats HNSW; an index should be added only if the Corpus grows by orders of magnitude.

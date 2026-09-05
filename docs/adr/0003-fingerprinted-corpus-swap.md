---
status: accepted
---

# An ingestion is fingerprinted, and embedded before it is swapped in

Ingestion decides whether to run by comparing a fingerprint of three things — the Source's upstream commit, the embedding model, and the chunker version — against the last completed run, and rebuilds the Source's share of the Corpus only when they differ. Every Chunk is embedded before the write begins, and the write replaces the Source in a single transaction.

The commit alone is the obvious fingerprint and it is not enough. Chunks are a product of the Source _and_ of how we cut and embed it, so changing the chunker or the embedding model has to rebuild a Corpus whose upstream has not moved. Leaving those out produces the worst available failure: a Corpus silently mixing vectors from two models, which retrieval cannot detect because a similarity search always returns its nearest neighbours.

## Consequences

- Embedding the whole Source before writing means a rebuild holds every vector in memory and pays for the embeddings before it knows the write will succeed. At tens of Pages that is cheap, and it is what keeps a failure partway through from leaving a half-updated Corpus.
- The chunker version is a constant a human must remember to bump. Forgetting it means a nightly run keeps serving Chunks the current code would not produce.
- Nothing detects a Source that changes without its commit changing, which is a property of git we are relying on deliberately.
- Because the swap deletes and reinserts, Page and Chunk identifiers are not stable across a rebuild. Nothing may store a reference to them expecting otherwise.
